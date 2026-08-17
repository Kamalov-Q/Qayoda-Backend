import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { JwtModule } from '@nestjs/jwt';
import { ListingsModule } from '../listings/listings.module';
import { IamModule } from '../iam/iam.module';
import { ChatController } from './chat.controller';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatFacade } from './chat.facade';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    JwtModule.register({}),
    ListingsModule,
    IamModule,
  ],
  controllers: [ChatController],
  providers: [
    ConversationRepository,
    MessageRepository,
    ChatService,
    ChatGateway,
    ChatFacade,
    WsJwtGuard,
  ],
  exports: [ChatFacade],
})
export class ChatModule {}
