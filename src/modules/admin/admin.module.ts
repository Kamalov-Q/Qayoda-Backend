import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { ReportsModule } from '../reports/reports.module';
import { User } from '../users/entities/user.entity';
import { Listing } from '../listings/entities/listing.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminSeedService } from './admin-seed.service';

/**
 * The web dashboard's own module. It reads other modules' entities directly
 * rather than going through their services: those are shaped for the app's
 * screens (one profile, one viewport), while the dashboard wants tables and
 * counts across everything.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, Listing]), AuthModule, ListingsModule, ReportsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminSeedService],
})
export class AdminModule {}
