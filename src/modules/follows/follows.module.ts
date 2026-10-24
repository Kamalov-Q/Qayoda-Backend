import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Follow } from './follow.entity';
import { User } from '../users/entities/user.entity';
import { FollowsService } from './follows.service';
import { FollowsController } from './follows.controller';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Following people. BlocksService comes from the global BlocksModule, and the
 * users table is read directly for the two counter columns — the same
 * precedent as every other module that needs five columns of it rather than
 * its service.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Follow, User]),
    AuthModule,
    // "X started following you" is the only thing a follow announces.
    NotificationsModule,
  ],
  controllers: [FollowsController],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
