import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { Agent } from 'https';

/**
 * Last-resort rate if CBU has never answered since boot. Deliberately a
 * little stale-looking so a broken fetch shows up in prices people question,
 * rather than silently freezing commerce on a wrong-but-plausible number.
 */
const FALLBACK_USD_UZS = 12800;

/**
 * How old the rate may get before every half-hourly tick starts trying to
 * replace it. Longer than a day would mean a failed morning going unnoticed
 * until the next one; shorter would hammer CBU for a number it only
 * publishes once.
 */
const MAX_RATE_AGE_HOURS = 25;

/**
 * IPv4 only.
 *
 * Defensive, for the commonest explanation of the symptom this was written
 * for: the call returns in under a second from a laptop and times out at ten
 * from the production droplet. Node resolves AAAA before A, and a host that
 * advertises IPv6 it cannot actually route on sends the request out over v6
 * to sit there until the timeout. Pinning the family costs nothing if that
 * was never the problem, and the retry below covers the cases where it
 * wasn't.
 */
const ipv4 = new Agent({ family: 4, keepAlive: true });

interface CbuRow {
  Ccy: string;
  Rate: string;
}

/**
 * One number the whole marketplace hangs on: how many so'm one dollar is.
 * Sourced from the Central Bank of Uzbekistan's public JSON (no key, updated
 * daily), cached in memory, refreshed every morning after CBU publishes.
 */
@Injectable()
export class RatesService implements OnModuleInit {
  private readonly logger = new Logger(RatesService.name);
  private usdToUzs = FALLBACK_USD_UZS;
  private updatedAt: Date | null = null;

  constructor(private readonly http: HttpService) {}

  onModuleInit() {
    // Fire and forget: boot must not hang on CBU being slow.
    void this.refresh();
  }

  /**
   * The scheduled refresh: once, after CBU publishes, Tashkent time.
   *
   * This is the happy path and nothing more. Everything that makes the rate
   * survive a bad morning is in `retryWhileStale` below — a daily cron with
   * no retry means one timed-out request costs a whole day of correct
   * prices, which is exactly what happened on the first deploy.
   */
  @Cron('0 30 9 * * *')
  async refresh(): Promise<void> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<CbuRow[]>(
          'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/',
          { timeout: 10_000, httpsAgent: ipv4 },
        ),
      );
      const rate = Number(data?.[0]?.Rate);
      if (Number.isFinite(rate) && rate > 1000) {
        this.usdToUzs = rate;
        this.updatedAt = new Date();
        this.logger.log(`USD/UZS rate refreshed: ${rate}`);
      }
    } catch (e) {
      this.logger.warn(
        `CBU rate fetch failed, keeping ${this.usdToUzs}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Keep trying until there is a real number.
   *
   * Cheap when things are fine: a fresh rate makes this a timestamp
   * comparison and nothing else, so CBU still sees one request a day. It
   * only reaches the network when the rate is missing or a day stale, which
   * is precisely when being wrong is costing something.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async retryWhileStale(): Promise<void> {
    if (this.isFresh()) return;
    this.logger.warn(
      this.updatedAt
        ? `Rate is stale (last good ${this.updatedAt.toISOString()}) — retrying`
        : `Still on the fallback rate ${FALLBACK_USD_UZS} — retrying`,
    );
    await this.refresh();
  }

  private isFresh(): boolean {
    if (!this.updatedAt) return false;
    const ageHours = (Date.now() - this.updatedAt.getTime()) / 3_600_000;
    return ageHours < MAX_RATE_AGE_HOURS;
  }

  current() {
    return {
      usdToUzs: this.usdToUzs,
      updatedAt: this.updatedAt,
      /**
       * True while this is a guess rather than CBU's number. Worth saying
       * out loud: a price converted at the fallback is wrong by whatever the
       * som has done since the constant was written.
       */
      isFallback: this.updatedAt === null,
    };
  }

  /** Normalises an offer price to USD for filtering and sorting. */
  toUsd(price: number | string, currency: string): number {
    const n = Number(price);
    if (currency === 'UZS') return Math.round((n / this.usdToUzs) * 100) / 100;
    return n;
  }
}
