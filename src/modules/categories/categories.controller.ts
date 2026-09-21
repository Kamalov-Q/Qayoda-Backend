import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { CategoriesService } from './categories.service';
import {
  CreateCategoryDto,
  DeleteCategoryQueryDto,
  UpdateCategoryDto,
} from './dto/category.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @ApiOperation({
    summary: 'Property categories the app offers',
    description:
      'Active categories in display order, with names in both languages and an icon key. Public: the app reads it before sign-in to build the filters and the post form.',
  })
  @Get()
  list() {
    return this.categories.listPublic();
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/categories')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @ApiOperation({ summary: 'All categories, hidden included, with listing counts' })
  @Get()
  list() {
    return this.categories.listAdmin();
  }

  @ApiOperation({ summary: 'Create a category' })
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @ApiOperation({
    summary: 'Edit a category',
    description:
      'Names, icon, order, visibility and the floor rule. The slug cannot change. Turning floorCapable off clears the floors of the listings in it.',
  })
  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(slug, dto);
  }

  @ApiOperation({
    summary: 'Delete a category',
    description:
      'If any listing uses it, pass ?moveTo=<slug>: those listings are refiled there first. Without it the request is refused with CATEGORY_IN_USE and the count.',
  })
  @Delete(':slug')
  remove(@Param('slug') slug: string, @Query() query: DeleteCategoryQueryDto) {
    return this.categories.remove(slug, query.moveTo);
  }
}
