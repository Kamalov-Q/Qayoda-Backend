import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { SupportMessage, SupportThread } from './support.entity';
import { User } from '../users/entities/user.entity';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import {
  AdminSupportController,
  SupportController,
} from './support.controller';

/** The line between a user and the support desk, live over `/support`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([SupportThread, SupportMessage, User]),
    // The gateway verifies the socket's token itself, the same way
    // ChatGateway does. AuthModule exports its guards and services but not
    // JwtService, so the module that uses it has to register it.
    JwtModule.register({}),
    AuthModule,
    // For readForwardable(): the permission check on a forwarded message
    // belongs to the chat that owns it, not to a copy of the rule here.
    ChatModule,
  ],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}
