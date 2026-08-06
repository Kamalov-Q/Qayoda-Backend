import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox.event.entity';
import { ProcessedEvent } from './processed-event.entity';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { OutBoxService } from './outbox.service';
import { OutboxRelayService } from './outbox-relay.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent, ProcessedEvent]),
    EventEmitterModule.forRoot({ delimiter: '.' }),
    ScheduleModule.forRoot(),
  ],
  providers: [OutBoxService, OutboxRelayService],
  exports: [OutBoxService],
})
export class EventsModule {}
