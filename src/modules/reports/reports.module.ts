import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingReport } from './report.entity';
import { ChatReport } from './chat-report.entity';
import { Conversation } from '../chat/entities/conversation.entity';
import { Message } from '../chat/entities/message.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { ReportsService } from './reports.service';
import { ChatReportsService } from './chat-reports.service';
import {
  AdminChatReportsController,
  AdminReportsController,
  ChatReportsController,
  ReportsController,
} from './reports.controller';

/**
 * Listing reports: users flag, admins triage. Reads the listings and users
 * tables directly (same precedent as AdminModule) rather than importing
 * their modules — it needs three columns of each, not their services.
 */
@Module({
  imports: [TypeOrmModule.forFeature([
      ListingReport,
      ChatReport,
      Conversation,
      Message,
      Listing,
      User,
    ]), AuthModule],
  controllers: [
    ReportsController,
    AdminReportsController,
    ChatReportsController,
    AdminChatReportsController,
  ],
  providers: [ReportsService, ChatReportsService],
  exports: [ReportsService, ChatReportsService],
})
export class ReportsModule {}
