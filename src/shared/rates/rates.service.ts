import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';

/**
 * Last-resort rate if CBU has never answered since boot. Deliberately a
 * little stale-looking so a broken fetch shows up in prices people question,
 * rather than silently freezing commerce on a wrong-but-plausible number.
 */
const FALLBACK_USD_UZS = 12800;

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

  @Cron('0 30 9 * * *') // CBU publishes in the morning, Tashkent time
  async refresh(): Promise<void> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<CbuRow[]>(
          'https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/',
          { timeout: 10_000 },
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

  current() {
    return { usdToUzs: this.usdToUzs, updatedAt: this.updatedAt };
  }

  /** Normalises an offer price to USD for filtering and sorting. */
  toUsd(price: number | string, currency: string): number {
    const n = Number(price);
    if (currency === 'UZS') return Math.round((n / this.usdToUzs) * 100) / 100;
    return n;
  }
}
