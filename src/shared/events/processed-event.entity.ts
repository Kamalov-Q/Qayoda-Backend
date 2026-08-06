import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn('uuid', { name: 'event_id' }) event_id: string;

  @PrimaryColumn({ name: 'handler_name', length: 120 }) handlerName: string;

  @CreateDateColumn({name: 'processed_at'}) processedAt: Date;

}
