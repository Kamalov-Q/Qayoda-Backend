import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface FiscalLine {
    title: string;
    unitPriceTiyin: number;
    count: number;
    totalTiyin: number;
    vatPercent: number;
    vatTiyin: number;
    mxik: string;
    packageCode: string;
    tin: string;

}

@Injectable()
export class FiscalService {
    private readonly logger = new Logger(FiscalService.name);

    constructor(
        private readonly config: ConfigService
    ) {
        // Read once, at boot, so a typo is a line in the startup log rather
        // than a surprise during somebody's payment.
        if (this.enabled && this.vatPercent === null) {
            this.logger.error(
                'FISCAL_VAT_PERCENT must be a number 0..100 — fiscalisation is OFF until it is fixed. ' +
                'Payments still work; no receipts are sent.',
            );
        }
    }

    /**
     * Every value a receipt needs. All-or-nothing: with any of them missing
     * no receipt is attempted, rather than one throwing halfway through a
     * payment callback.
     *
     * VAT is part of that check. It is read inside Payme's
     * CheckPerformTransaction, and a malformed one used to throw there —
     * turning a config typo into a failed webhook instead of a skipped
     * receipt.
     */
    get enabled(): boolean {
        return ['FISCAL_MXIK', 'FISCAL_PACKAGE_CODE', 'FISCAL_TIN'].every((k) => !!this.config.get<string>(k)?.trim())
            && this.vatPercent !== null;
    }

    /** The configured VAT rate, or null when it is not a usable number. */
    private get vatPercent(): number | null {
        const raw = this.config.get<string>('FISCAL_VAT_PERCENT')?.trim();
        const n = Number(raw || 0);
        return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
    }

    topupLine(amountTiyin: number): FiscalLine {
        const vatPercent = this.vatPercent;
        if (vatPercent === null) {
            throw new Error(`FISCAL_VAT_PERCENT must be 0..100, got "${this.config.get('FISCAL_VAT_PERCENT')}"`);
        }

        // VAT is inside the price: vat = total * p / (100 + p)
        const vatTiyin = vatPercent > 0 ? Math.round((amountTiyin * vatPercent) / (100 + vatPercent)) : 0;

        return {
            title: this.config.get<string>('FISCAL_ITEM_NAME') ?? "Growen City balansini to'ldirish",
            unitPriceTiyin: amountTiyin,
            count: 1,
            totalTiyin: amountTiyin,
            vatPercent,
            vatTiyin,
            mxik: this.config.getOrThrow<string>('FISCAL_MXIK'),
            packageCode: this.config.getOrThrow<string>('FISCAL_PACKAGE_CODE'),
            tin: this.config.getOrThrow<string>('FISCAL_TIN')
        }

    }

}