import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { UserBlock } from './block.entity';
import { User } from '../users/entities/user.entity';
import { BlocksService } from './blocks.service';
import { BlocksController } from './blocks.controller';

/**
 * Blocking between users.
 *
 * Global because the rule has to be checked wherever two people meet — chat,
 * profiles, presence — and threading an import through every one of those
 * modules would be a lot of ceremony for one service with five methods.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UserBlock, User]),
    AuthModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
