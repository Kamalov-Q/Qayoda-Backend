import { Injectable } from '@nestjs/common';
import { MessageRepository } from './repositories/message.repository';

@Injectable()
export class ChatFacade {
  constructor(private readonly messages: MessageRepository) {}

  getUnreadCount(userId: string): Promise<number> {
    return this.messages.countUnreadTotal(userId);
  }
}
