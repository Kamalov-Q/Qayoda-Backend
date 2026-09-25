import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { JwtModule } from '@nestjs/jwt';
import { ListingsModule } from '../listings/listings.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
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
    UsersModule,
    AuthModule,
    // Circular by nature: chat asks "are these two blocked", and blocks asks
    // this module's gateway to announce a change. forwardRef on both sides is
    // what lets Nest build either one first.
    forwardRef(() => BlocksModule),
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
  // ChatGateway is exported for BlocksModule, which pushes a block change to
  // the blocker's own devices. Without this the container cannot build
  // BlocksController — and a missing provider is a boot-time crash, not a
  // build error.
  exports: [ChatFacade, ChatService, ChatGateway],
})
export class ChatModule {}
