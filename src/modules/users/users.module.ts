import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { User } from './entities/user.entity';
import { UserRepository } from './repositories/user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersFacade } from './users.facade';

/**
 * The user record and everything read off it — profile, avatar, presence, and
 * the public card another user opens from a chat or a listing.
 *
 * It reaches into ListingsModule for the ads on that card, and is reached back
 * into through UsersFacade rather than the service, so a consumer cannot write
 * to a user by accident. Profile routes live in MediaModule's
 * ProfileController, which needs MediaFacade for avatar processing.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), ListingsModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, UsersFacade, UserRepository],
  exports: [UsersFacade, UsersService, TypeOrmModule],
})
export class UsersModule {}
