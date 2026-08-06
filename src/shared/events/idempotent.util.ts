import { DataSource } from 'typeorm';
import { ProcessedEvent } from './processed-event.entity';

export async function withIdempotency(
  dataSource: DataSource,
  eventId: string,
  handlerName: string,
  work: () => Promise<void>,
) {
  const repo = dataSource.getRepository(ProcessedEvent);

  if (await repo.findOneBy({ event_id: eventId, handlerName })) return;
  await work();

  await repo.save(repo.create({ event_id: eventId, handlerName }));
}
