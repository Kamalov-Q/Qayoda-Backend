import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OutboxEvent } from './outbox.event.entity';

/** How long a dispatched event stays readable. `otp.requested` payloads carry
 *  the code in plaintext — the whole point of hashing it in `otp_codes` is lost
 *  if a copy sits in `outbox_events` forever. Codes expire in 10 minutes, so a
 *  day is generous and still leaves recent events around for debugging. */
const DISPATCHED_RETENTION_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly emitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async relay() {
    if (this.running) return;

    this.running = true;

    try {
      await this.dataSource.transaction(async (manager) => {
        const batch = await manager
          .createQueryBuilder(OutboxEvent, 'e')
          .where('e.dispatched_at IS NULL')
          .orderBy('e.created_at', 'ASC')
          .limit(50)
          .setLock('pessimistic_write')
          .getMany();

        for (const event of batch) {
          try {
            await this.emitter.emitAsync(
              event.eventName,
              event.payload,
              event.id,
            );
            await manager.update(OutboxEvent, event.id, {
              dispatchedAt: new Date(),
            });
          } catch (err) {
            this.logger.error(
              `Failed dispatching ${event.eventName} (${event.id})`,
              err,
            );
          }
        }
      });
    } finally {
      this.running = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async prune() {
    const cutoff = new Date(Date.now() - DISPATCHED_RETENTION_MS);

    const { affected } = await this.dataSource
      .getRepository(OutboxEvent)
      .createQueryBuilder()
      .delete()
      .where('dispatched_at IS NOT NULL')
      .andWhere('dispatched_at < :cutoff', { cutoff })
      .execute();

    if (affected) this.logger.log(`Pruned ${affected} dispatched events`);
  }
}
