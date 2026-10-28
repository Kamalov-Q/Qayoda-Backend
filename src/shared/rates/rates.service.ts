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
 * Where the number currently in hand came from.
 *
 * Worth tracking rather than inferring from a timestamp: once there is a
 * second source, "we have a rate" and "we have the OFFICIAL rate" stop being
 * the same question, and every caller that wants to qualify a converted
 * price needs the second one.
 */
export type RateSource = 'CBU' | 'MARKET' | 'CONSTANT';

/** One timeout for both sources. Long enough for a slow TLS handshake. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Sanity bounds for a USD/UZS quote.
 *
 * The som trades around twelve thousand to the dollar. The lower bound was
 * always here; the upper one arrived with the second source, because the two
 * APIs do not have to agree on units — one returning a rate per 1000 som, or
 * a decimal slip in either, would otherwise be accepted and silently reprice
 * the entire marketplace. A number outside this range is a bug somewhere,
 * not a devaluation, and the right response is to keep the last good one.
 */
const MIN_PLAUSIBLE_RATE = 1_000;
const MAX_PLAUSIBLE_RATE = 100_000;

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

/** open.er-api.com's shape. Snake case because that is what it sends. */
interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
  time_last_update_utc?: string;
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
  private source: RateSource = 'CONSTANT';

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
    // CBU first, always. It is the Central Bank's published rate — the
    // official number, and the one anybody in Uzbekistan will check a price
    // against. The market source below is a second-best, not an equal.
    const official = await this.fetchCbu();
    if (official !== null) {
      this.apply(official, 'CBU');
      return;
    }

    const market = await this.fetchMarket();
    if (market !== null) {
      this.apply(market, 'MARKET');
      return;
    }

    this.logger.warn(
      `Both rate sources failed — keeping ${this.usdToUzs} (${this.source})`,
    );
  }

  /**
   * The Central Bank of Uzbekistan. Authoritative, and geo-restricted.
   *
   * Returns null rather than throwing: a failure here is the normal path on
   * a host CBU will not talk to, and refresh() needs to carry on to the
   * second source rather than unwind.
   */
  private async fetchCbu(): Promise<number | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<CbuRow[]>(
          'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/',
          { timeout: FETCH_TIMEOUT_MS, httpsAgent: ipv4 },
        ),
      );
      return this.plausible(Number(data?.[0]?.Rate), 'CBU');
    } catch (e) {
      this.logger.warn(`CBU rate fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * A market rate, for when CBU cannot be reached at all.
   *
   * This exists because of a real and permanent condition rather than a
   * transient one: cbu.uz answers in well under a second from a browser in
   * Uzbekistan and times out at ten seconds from the production droplet in
   * New York. It is a government site that does not serve foreign IPs, so
   * no amount of retrying fixes it — the app was running on the hardcoded
   * constant, about 7% away from the real rate, on every price in the
   * marketplace.
   *
   * open.er-api.com: no key, no quota to exhaust, and it publishes its own
   * last-update timestamp. Measured against CBU's 12004.02 on 29.10.2026 it
   * returned 11893.79 — roughly 1% out, versus the constant's 7%.
   *
   * Explicitly NOT a replacement for CBU. It is a mid-market aggregate, not
   * the central bank's published figure, which is why the source is recorded
   * and `current()` reports it as a fallback.
   */
  private async fetchMarket(): Promise<number | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<ErApiResponse>('https://open.er-api.com/v6/latest/USD', {
          timeout: FETCH_TIMEOUT_MS,
          httpsAgent: ipv4,
        }),
      );
      // The endpoint answers 200 with `result: "error"` on its own failures,
      // so the status code alone does not mean there is a number here.
      if (data?.result !== 'success') {
        this.logger.warn(`Market rate source returned: ${data?.result}`);
        return null;
      }
      return this.plausible(Number(data?.rates?.UZS), 'market');
    } catch (e) {
      this.logger.warn(`Market rate fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** A quote, or null if it is outside the range any real rate lives in. */
  private plausible(rate: number, which: string): number | null {
    if (
      !Number.isFinite(rate) ||
      rate < MIN_PLAUSIBLE_RATE ||
      rate > MAX_PLAUSIBLE_RATE
    ) {
      this.logger.warn(`Ignoring implausible ${which} rate: ${rate}`);
      return null;
    }
    return rate;
  }

  private apply(rate: number, source: RateSource): void {
    this.usdToUzs = rate;
    this.updatedAt = new Date();
    this.source = source;
    this.logger.log(`USD/UZS rate refreshed from ${source}: ${rate}`);
  }

  /**
   * Keep trying until there is a real number.
   *
   * Cheap when things are fine: a fresh rate makes this a timestamp
   * comparison and nothing else, so CBU still sees one request a day. It
   * only reaches the network when the rate is missing or a day stale, which
   * is precisely when being wrong is costing something.
   *
   * Deliberately does NOT fire merely because the number came from the
   * market source rather than CBU. On a host CBU permanently refuses, that
   * would mean a ten-second timeout every half hour forever, to replace a
   * rate that is about 1% out — noise in the logs bought with nothing. The
   * daily cron still tries CBU first every morning, so a blockade lifting is
   * picked up within a day.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async retryWhileStale(): Promise<void> {
    if (this.isFresh()) return;
    this.logger.warn(
      this.updatedAt
        ? `Rate is stale (last good ${this.updatedAt.toISOString()}, source ${this.source}) — retrying`
        : `Still on the hardcoded rate ${FALLBACK_USD_UZS} — retrying`,
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
       * Which of the three this number is. Added with the market source,
       * because `updatedAt` stopped being able to answer the question: a
       * market rate is live and timestamped and still not the official one.
       */
      source: this.source,
      /**
       * True while this is NOT the Central Bank's published number.
       *
       * The meaning widened when the second source arrived — it used to mean
       * "we have never fetched anything". It now covers the market rate too,
       * which is live and roughly 1% out rather than dead and 7% out, but is
       * still not the figure a seller will check their price against.
       */
      isFallback: this.source !== 'CBU',
    };
  }

  /** Normalises an offer price to USD for filtering and sorting. */
  toUsd(price: number | string, currency: string): number {
    const n = Number(price);
    if (currency === 'UZS') return Math.round((n / this.usdToUzs) * 100) / 100;
    return n;
  }
}
