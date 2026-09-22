import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { AmenitiesService } from './amenities.service';
import { CreateAmenityDto, UpdateAmenityDto } from './dto/amenity.dto';

@ApiTags('Amenities')
@Controller('amenities')
export class AmenitiesController {
  constructor(private readonly amenities: AmenitiesService) {}

  @ApiOperation({
    summary: 'Amenities the post form offers',
    description:
      'Active amenities in display order, with names in both languages. Public: the app reads it to build the "Qo‘shimcha xususiyatlar" chips instead of carrying a hard-coded list.',
  })
  @Get()
  list() {
    return this.amenities.listPublic();
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/amenities')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAmenitiesController {
  constructor(private readonly amenities: AmenitiesService) {}

  @ApiOperation({ summary: 'All amenities, hidden included, with usage counts' })
  @Get()
  list() {
    return this.amenities.listAdmin();
  }

  @ApiOperation({ summary: 'Create an amenity' })
  @Post()
  create(@Body() dto: CreateAmenityDto) {
    return this.amenities.create(dto);
  }

  @ApiOperation({
    summary: 'Edit an amenity',
    description: 'Names, order and visibility. The key cannot change.',
  })
  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateAmenityDto) {
    return this.amenities.update(key, dto);
  }

  @ApiOperation({
    summary: 'Delete an amenity',
    description:
      'Also removes the key from every listing that picked it, in one transaction. The response reports how many listings were touched.',
  })
  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.amenities.remove(key);
  }
}
