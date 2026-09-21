import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { AdminCategoriesController, CategoriesController } from './categories.controller';

/**
 * Property categories as data. ListingsModule imports this to validate a
 * listing's category and read its floor rule; nothing here imports listings,
 * so there is no cycle — the few listing-table updates it makes are plain SQL.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Category]), AuthModule],
  controllers: [CategoriesController, AdminCategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
