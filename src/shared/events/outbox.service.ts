import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxEvent } from './outbox.event.entity';

@Injectable()
export class OutBoxService {
  constructor(private readonly dataSource: DataSource) {}

  async publish(
    eventName: string,
    payload: Record<string, unknown>,
    manager?: EntityManager,
  ) {
    const repo = (manager ?? this.dataSource.manager).getRepository(
      OutboxEvent,
    );
    await repo.save(repo.create({ eventName, payload }));
  }
}
