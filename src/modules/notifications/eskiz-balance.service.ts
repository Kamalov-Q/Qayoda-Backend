import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EskizService } from './eskiz.service';

const LOW_BALANCE_SOM = 50_000;

@Injectable()
export class EskizBalanceService {
  private readonly logger = new Logger(EskizBalanceService.name);

  constructor(private readonly eskiz: EskizService) {}

  @Cron('0 0 9 * * *')
  async check(): Promise<void> {
    try {
      const balance = await this.eskiz.getBalance();
      if (balance < LOW_BALANCE_SOM) {
        // Worth escalating to a real alert before launch: at zero balance
        // nobody can sign in at all, and you'd hear it from users first.
        this.logger.error(
          `Eskiz balance low: ${balance} so'm — top up, logins fail at zero.`,
        );
      } else {
        this.logger.log(`Eskiz balance: ${balance} so'm`);
      }
    } catch (e) {
      this.logger.error(`Balance check failed: ${(e as Error).message}`);
    }
  }
}
