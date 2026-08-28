import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingOwnershipGuard } from './guards/listing-ownership.guard';
import { UpdateOffersDto } from './dto/update-offers.dto';
import { UpdateGeometryDto } from './dto/update-geometry.dto';
import { ErrorResponse } from 'src/shared/responses/error.response';
import type { ListingRequest } from './types/listing-request.type';
import type { AuthUser } from 'src/modules/auth/types/auth-user.type';
import { UpdateImagesDto } from './dto/update-images.dto';

// `type` has to be stated: the guarded routes take the request via @Req(), so
// there is no @Param() for Swagger to reflect a type off.
const LISTING_ID_PARAM = {
  name: 'id',
  type: String,
  format: 'uuid',
  example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34',
  description: 'Listing id.',
};

const NOT_OWNER = {
  type: ErrorResponse,
  description: 'The listing belongs to another user.',
};

const NO_LISTING = {
  type: ErrorResponse,
  description: 'No listing exists with this id.',
};

@ApiTags('Listings')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @ApiOperation({
    summary: 'Publish a listing',
    description: [
      'Creates a listing together with its offers and property outline, and publishes it immediately — the listing comes back as `ACTIVE`.',
      '',
      'The outline is validated twice: for shape and bounds on the way in, then for geometric validity (self-intersection and the like) in PostGIS.',
    ].join('\n'),
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'Body failed validation, or the polygon is self-intersecting.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user.sub, dto);
  }

  @ApiOperation({
    summary: 'List your own listings',
    description:
      'Returns every listing owned by the caller, in any status — drafts and archived ones included.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  // Must stay declared above `:id` — routes match in declaration order, and
  // `mine` would otherwise be read as a listing id and rejected by ParseUUIDPipe.
  @Get('mine')
  findMine(@CurrentUser() user: AuthUser) {
    return this.listingsService.findMine(user.sub);
  }

  @ApiOperation({
    summary: 'List saved listings',
    description:
      'Every listing the caller has saved, most recently saved first, in the same shape as `/listings/mine`.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  // Same declaration-order rule as `mine`: must sit above `:id`.
  @Get('saved')
  findSaved(@CurrentUser() user: AuthUser) {
    return this.listingsService.findSaved(user.sub);
  }

  @ApiOperation({
    summary: 'Save a listing',
    description:
      'Bookmarks the listing for the caller. Idempotent — saving an already-saved listing changes nothing.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiNotFoundResponse(NO_LISTING)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Put(':id/save')
  saveListing(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingsService.saveListing(user.sub, id);
  }

  @ApiOperation({
    summary: 'Unsave a listing',
    description:
      'Removes the bookmark. Idempotent — unsaving something never saved is not an error.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete(':id/save')
  unsaveListing(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.listingsService.unsaveListing(user.sub, id);
  }

  @ApiOperation({
    summary: 'Fetch a listing',
    description:
      'Public endpoint: returns the listing with its offers and images.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'The id is not a valid UUID.',
  })
  @ApiNotFoundResponse(NO_LISTING)
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.listingsService.findById(id);
  }

  @ApiOperation({
    summary: 'Replace a listing’s offers',
    description:
      'Swaps the full set of offers in one transaction. Offers not present in the body are deleted, so send every purpose you want to keep.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'Body failed validation.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiForbiddenResponse(NOT_OWNER)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, ListingOwnershipGuard)
  @Put(':id/offers')
  updateOffers(@Req() req: ListingRequest, @Body() dto: UpdateOffersDto) {
    return this.listingsService.updateOffers(req.listing, dto);
  }

  @ApiOperation({
    summary: 'Redraw a listing’s outline',
    description:
      'Replaces the property outline. The centroid used for map pins is recomputed from the new outline.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'Body failed validation, or the polygon is self-intersecting.',
  })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiForbiddenResponse(NOT_OWNER)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, ListingOwnershipGuard)
  @Put(':id/geometry')
  updateGeometry(@Req() req: ListingRequest, @Body() dto: UpdateGeometryDto) {
    return this.listingsService.updateGeometry(req.listing, dto);
  }

  @UseGuards(JwtAccessGuard, ListingOwnershipGuard)
  @Put(':id/images')
  updateImages(@Req() req: ListingRequest, @Body() dto: UpdateImagesDto) {
    return this.listingsService.updateImages(req.listing, dto);
  }

  @ApiOperation({
    summary: 'Archive a listing',
    description:
      'Soft-delete: the listing moves to `ARCHIVED` and drops off the map, but the record is kept.',
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiForbiddenResponse(NOT_OWNER)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, ListingOwnershipGuard)
  @Delete(':id')
  archive(@Req() req: ListingRequest) {
    return this.listingsService.archive(req.listing);
  }

  @ApiOperation({
    summary: 'Restore an archived listing',
    description: [
      'Undoes an archive: the listing returns to `ACTIVE` and is projected back onto the map. Restoring a listing that is not archived changes nothing and returns it as-is.',
      '',
      'Note that archiving deletes the stored image files while keeping their rows, so a restored listing needs its photos re-uploaded via `PUT /listings/:id/images`.',
    ].join('\n'),
  })
  @ApiParam(LISTING_ID_PARAM)
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiForbiddenResponse(NOT_OWNER)
  @ApiNotFoundResponse(NO_LISTING)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, ListingOwnershipGuard)
  @Patch(':id/restore')
  restore(@Req() req: ListingRequest) {
    return this.listingsService.restore(req.listing);
  }
}
