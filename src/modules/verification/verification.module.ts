import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { SupportModule } from '../support/support.module';
import { User } from '../users/entities/user.entity';
import { VerificationRequest } from './verification-request.entity';
import { VerificationService } from './verification.service';
import {
  AdminVerificationController,
  VerificationController,
} from './verification.controller';

/**
 * Applying for the verified badge, and the desk that decides.
 *
 * Reads the users table directly to set the badge — the same precedent
 * reports and stories set. It takes SupportModule because a rejection is a
 * message to a person, not a status change they are left to discover.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationRequest, User]),
    AuthModule,
    // For disposing of the documents once a decision is made.
    MediaModule,
    SupportModule,
  ],
  controllers: [VerificationController, AdminVerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
