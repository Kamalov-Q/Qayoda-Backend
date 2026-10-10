import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { FiscalStatus, PaymentProviderKind, PaymentStatus, toTiyin } from '../../billing.constants';
import { Payment } from '../../entities/payment.entity';
import { FiscalService } from '../../fiscal.service';
import { PaymentsService } from '../../payments.service';
import { PaymentProvider } from '../payment-provider';

// ─── Click Shop API (docs.click.uz → Click-API Request), verified on service 85772 ──

export const CLICK_PAY_URL = 'https://my.click.uz/services/pay';

export const CLICK = {
  OK: 0, SIGN_FAILED: -1, BAD_AMOUNT: -2, BAD_ACTION: -3, ALREADY_PAID: -4,
  NOT_FOUND: -5, TXN_NOT_FOUND: -6, UPDATE_FAILED: -7, BAD_REQUEST: -8, CANCELLED: -9,
} as const;

const CLICK_NOTE: Record<number, string> = {
  0: 'Success', [-1]: 'SIGN CHECK FAILED!', [-2]: 'Incorrect parameter amount', [-3]: 'Action not found',
  [-4]: 'Already paid', [-5]: 'User/order does not exist', [-6]: 'Transaction does not exist',
  [-7]: 'Failed to update user', [-8]: 'Error in request from click', [-9]: 'Transaction cancelled',
};

const PREPARE_FIELDS = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];
const COMPLETE_FIELDS = [...PREPARE_FIELDS, 'merchant_prepare_id'];

/**
 * Prepare : md5(click_trans_id + service_id + SECRET + merchant_trans_id + amount + action + sign_time)
 * Complete: md5(click_trans_id + service_id + SECRET + merchant_trans_id + merchant_prepare_id + amount + action + sign_time)
 * Over the literal strings Click sent (amount "5000", not "5000.00").
 */
export function buildSignString(b: Record<string, string>, secret: string, complete: boolean): string {
  const raw = complete
    ? b.click_trans_id + b.service_id + secret + b.merchant_trans_id + b.merchant_prepare_id + b.amount + b.action + b.sign_time
    : b.click_trans_id + b.service_id + secret + b.merchant_trans_id + b.amount + b.action + b.sign_time;
  return createHash('md5').update(raw).digest('hex');
}

// ──────────────────────────────────────────────────────────────────────────

type ClickBody = Record<string, string>;
type ClickResponse = Record<string, unknown>;

@Injectable()
export class ClickProvider implements PaymentProvider {
  readonly kind = PaymentProviderKind.CLICK;
  private readonly logger = new Logger(ClickProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly fiscal: FiscalService,
  ) {}

  buildPayUrl(payment: Payment): string {
    const params = new URLSearchParams({
      service_id: this.config.getOrThrow<string>('CLICK_SERVICE_ID'),
      merchant_id: this.config.getOrThrow<string>('CLICK_MERCHANT_ID'),
      amount: payment.amount,
      transaction_param: payment.id,
      return_url: this.config.getOrThrow<string>('CLICK_RETURN_URL'),
    });
    return `${CLICK_PAY_URL}?${params.toString()}`;
  }

  async handleWebhook(step: 'prepare' | 'complete', body: ClickBody): Promise<ClickResponse> {
    const complete = step === 'complete';
    const signatureValid = this.verifySignature(body, complete);

    let response: ClickResponse;
    try {
      response = complete ? await this.complete(body, signatureValid) : await this.prepare(body, signatureValid);
    } catch (err) {
      this.logger.error(`click ${step} crashed for ${body?.merchant_trans_id}`, err instanceof Error ? err.stack : String(err));
      response = this.reply(body, CLICK.UPDATE_FAILED);
    }

    await this.payments.logWebhook(this.kind, step, body ?? {}, signatureValid, response);
    return response;
  }

  private async prepare(b: ClickBody, signatureValid: boolean): Promise<ClickResponse> {
    if (b.action !== '0') return this.reply(b, CLICK.BAD_ACTION);
    if (!signatureValid) return this.reply(b, CLICK.SIGN_FAILED);

    const payment = await this.payments.findByMerchantRef(this.kind, b.merchant_trans_id);
    if (!payment) return this.reply(b, CLICK.NOT_FOUND);
    if (payment.status === PaymentStatus.PAID) return this.reply(b, CLICK.ALREADY_PAID);
    if (payment.status === PaymentStatus.CANCELLED) return this.reply(b, CLICK.CANCELLED);
    if (!this.amountMatches(b.amount, payment.amount)) return this.reply(b, CLICK.BAD_AMOUNT);

    const prepared = await this.payments.markPrepared(this.kind, payment, b.click_trans_id, b, Date.now(), b.click_paydoc_id ?? null);
    // Cancelled or paid between the read above and now.
    if (!prepared) return this.reply(b, CLICK.CANCELLED);
    return this.reply(b, CLICK.OK, { merchant_prepare_id: payment.prepareId });
  }

  private async complete(b: ClickBody, signatureValid: boolean): Promise<ClickResponse> {
    if (b.action !== '1') return this.reply(b, CLICK.BAD_ACTION);
    if (!signatureValid) return this.reply(b, CLICK.SIGN_FAILED);

    const payment = await this.payments.findByMerchantRef(this.kind, b.merchant_trans_id);
    if (!payment) return this.reply(b, CLICK.NOT_FOUND);
    if (payment.status === PaymentStatus.PAID) return this.reply(b, CLICK.ALREADY_PAID);
    if (payment.status === PaymentStatus.CANCELLED) return this.reply(b, CLICK.CANCELLED);
    if (!this.amountMatches(b.amount, payment.amount)) return this.reply(b, CLICK.BAD_AMOUNT);
    if (String(payment.prepareId) !== String(b.merchant_prepare_id)) return this.reply(b, CLICK.TXN_NOT_FOUND);
    // Complete must belong to the Click transaction that was prepared; a
    // never-prepared order has no transaction to complete.
    if (payment.status !== PaymentStatus.PREPARED || payment.providerTxnId !== b.click_trans_id) {
      return this.reply(b, CLICK.TXN_NOT_FOUND);
    }

    const clickError = Number(b.error);
    if (Number.isInteger(clickError) && clickError < 0) {
      await this.payments.cancel(this.kind, payment, 'provider_error', String(clickError), b);
      return this.reply(b, CLICK.CANCELLED);
    }

    // Click does not fiscalise Shop API payments for us → we submit after
    // commit (BillingEventsListener). Not configured = NONE, never a claim
    // that somebody else sent it.
    const fiscal = this.fiscal.enabled ? FiscalStatus.PENDING : FiscalStatus.NONE;
    const paid = await this.payments.markPaid(this.kind, payment, b.click_trans_id, b, fiscal, Date.now(), b.click_paydoc_id ?? null);
    if (!paid) return this.reply(b, CLICK.ALREADY_PAID);
    return this.reply(b, CLICK.OK, { merchant_confirm_id: payment.prepareId });
  }

  private verifySignature(b: ClickBody, complete: boolean): boolean {
    const secret = this.config.get<string>('CLICK_SECRET_KEY');
    if (!secret || !b) return false;
    const fields = complete ? COMPLETE_FIELDS : PREPARE_FIELDS;
    if (fields.some((f) => typeof b[f] !== 'string' || b[f].length === 0)) return false;

    const expected = Buffer.from(buildSignString(b, secret, complete));
    const given = Buffer.from(b.sign_string.toLowerCase());
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private amountMatches(clickAmount: string, ours: string): boolean {
    const a = toTiyin(clickAmount);
    return Number.isFinite(a) && Math.abs(a - toTiyin(ours)) <= 1;
  }

  private reply(b: ClickBody, error: number, extra: Record<string, unknown> = {}): ClickResponse {
    if (error !== CLICK.OK) this.logger.warn(`click action=${b?.action} order=${b?.merchant_trans_id} → ${error} ${CLICK_NOTE[error]}`);
    return {
      click_trans_id: Number(b?.click_trans_id) || 0,
      merchant_trans_id: b?.merchant_trans_id ?? '',
      error,
      error_note: CLICK_NOTE[error],
      ...extra,
    };
  }
}