import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ListingsModule } from '../listings/listings.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Reads across two modules and is read by none, so it hangs off both facades
// without pulling either into a cycle.
@Module({
  imports: [IamModule, ListingsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
