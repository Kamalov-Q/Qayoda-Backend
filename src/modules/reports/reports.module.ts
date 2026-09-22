import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListingReport } from './report.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { ReportsService } from './reports.service';
import { AdminReportsController, ReportsController } from './reports.controller';

/**
 * Listing reports: users flag, admins triage. Reads the listings and users
 * tables directly (same precedent as AdminModule) rather than importing
 * their modules — it needs three columns of each, not their services.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ListingReport, Listing, User]), AuthModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
