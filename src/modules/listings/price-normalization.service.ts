import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RatesService } from 'src/shared/rates/rates.service';

/**
 * How far the rate must move before the stored USD prices are rewritten.
 *
 * 0.1%. Not zero: the som moves a few som a day, which on a $8,000 flat is
 * cents, and rewriting every UZS row in the database to correct a cent is
 * write amplification bought with nothing.
 *
 * Measured against the rate those rows were LAST priced at, never against
 * yesterday's — so a run of sub-threshold days still accumulates and fires
 * once the total drift matters. Comparing day to day would let the error
 * creep up indefinitely, one ignorable step at a time.
 */
const REPRICE_THRESHOLD = 0.001;

/**
 * Keeps `price_usd` honest.
 *
 * Every price filter and every price sort in the app compares `price_usd`,
 * not `price` — so'm cannot be compared against dollars, and the column is
 * what makes "under $8,000" answerable with an index. But it is a CACHED
 * CONVERSION: written once at save time from whatever the rate was that day,
 * and until now never recomputed. The rate moves daily and nothing followed
 * it, so the numbers the database filtered and sorted on drifted away from
 * the prices people could see on screen.
 *
 * That went unnoticed while the drift was fractions of a percent a day. It
 * stopped being ignorable when the production server, which cannot reach
 * cbu.uz, spent its life on a hardcoded 12800 against a real rate near
 * 11900: every so'm listing's stored USD price was about 7.6% low, so a
 * search for "under $8,000" returned flats asking well over it.
 *
 * ── Why this is cheap ──────────────────────────────────────────────────
 *
 *  1. The hourly tick is a float comparison against a number held in this
 *     process. On the 23 hours out of 24 when the rate has not moved it
 *     touches the database not at all — no query, no connection, nothing.
 *  2. When it does run, it is two set-based UPDATEs. No row-by-row loop, no
 *     entity hydration, no ORM.
 *  3. `WHERE currency = 'UZS'` — dollar-quoted rows are skipped entirely.
 *     For them price_usd equals price by definition and no rate can change
 *     that.
 *  4. `AND price_usd IS DISTINCT FROM <new value>` — a row whose rounded
 *     figure did not actually change is not rewritten. No dead tuple, no WAL
 *     record, no index churn, no vacuum debt.
 *  5. The threshold above means a trivial wobble does not even reach step 2.
 *
 * At the current size (tens of rows) all of this is theatre. It is written
 * this way so it stays true at a hundred thousand listings, where a daily
 * row-by-row reprice would be a visible load spike and this is a seq scan
 * and a few thousand updated rows. Past roughly a million UZS offers the
 * single statement would be worth chunking, because it holds a row lock on
 * everything it touches for the length of one transaction; below that, the
 * added complexity costs more than it saves.
 */
@Injectable()
export class PriceNormalizationService {
  private readonly logger = new Logger(PriceNormalizationService.name);

  /**
   * The rate the stored columns currently reflect.
   *
   * In memory, deliberately. Persisting it would buy one skipped scan after
   * a deploy: on a cold start this is null, the first tick reprices, and the
   * IS DISTINCT FROM guard means that pass writes only rows that genuinely
   * differ — on an up-to-date database, none. A scan is a cheap price for
   * not having a second piece of state to keep in step with the first.
   */
  private lastRepricedRate: number | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rates: RatesService,
  ) {}

  /**
   * Hourly rather than daily, and for a reason that is not impatience: the
   * rate refresh can land at any hour. CBU publishes in the morning, the
   * market fallback answers whenever it is first asked, and a failed morning
   * is retried every thirty minutes. A daily reprice at a fixed time would
   * leave the stored prices up to a day behind the displayed ones.
   *
   * The cost of checking hourly is one float comparison.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async repriceIfRateMoved(): Promise<void> {
    try {
      const { usdToUzs } = this.rates.current();
      if (!this.shouldReprice(usdToUzs)) return;
      await this.reprice(usdToUzs);
    } catch (e) {
      // A cron that throws takes the scheduler down with it, and a stale
      // price_usd is a worse search result rather than an outage.
      this.logger.warn(`Reprice failed: ${(e as Error).message}`);
    }
  }

  private shouldReprice(rate: number): boolean {
    if (!Number.isFinite(rate) || rate <= 0) return false;
    if (this.lastRepricedRate === null) return true;
    const drift = Math.abs(rate - this.lastRepricedRate) / this.lastRepricedRate;
    return drift >= REPRICE_THRESHOLD;
  }

  /**
   * Both tables, in one transaction.
   *
   * Together because they are two copies of one fact: listing_map_points is
   * a read-model projection carrying the offer's price, and a map whose
   * price filter disagrees with the list's is worse than either being a
   * little stale.
   *
   * ROUND(... ::numeric, 2) matches RatesService.toUsd exactly — Math.round
   * of hundredths, which is round-half-away-from-zero, and so is Postgres's
   * ROUND on numeric. They have to agree: if the save path and this path
   * rounded differently, every row would flip between two values forever,
   * one write per hour each.
   *
   * The ::numeric cast is load-bearing. `price / $1` with a float on the
   * right yields double precision, and ROUND(double precision, integer) does
   * not exist in Postgres — the statement fails outright rather than
   * silently doing something else.
   */
  private async reprice(rate: number): Promise<void> {
    const { offers, points } = await this.dataSource.transaction(
      async (manager) => {
        const offerResult: [unknown[], number] = await manager.query(
          `UPDATE listing_offers
              SET price_usd = ROUND(price / $1::numeric, 2)
            WHERE currency = 'UZS'
              AND price_usd IS DISTINCT FROM ROUND(price / $1::numeric, 2)`,
          [rate],
        );
        const pointResult: [unknown[], number] = await manager.query(
          `UPDATE listing_map_points
              SET price_usd = ROUND(price / $1::numeric, 2)
            WHERE currency = 'UZS'
              AND price_usd IS DISTINCT FROM ROUND(price / $1::numeric, 2)`,
          [rate],
        );
        // node-postgres hands back [rows, rowCount] for an UPDATE.
        return { offers: offerResult[1] ?? 0, points: pointResult[1] ?? 0 };
      },
    );

    this.lastRepricedRate = rate;

    // Only worth a line when something moved. An hourly "updated 0 rows" is
    // how a log stops being read.
    if (offers || points) {
      this.logger.log(
        `Repriced at ${rate}: ${offers} offer(s), ${points} map point(s)`,
      );
    }
  }
}
