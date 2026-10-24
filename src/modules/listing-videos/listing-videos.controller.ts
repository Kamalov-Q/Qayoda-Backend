import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ListingVideosService } from './listing-videos.service';
import { CreateListingVideoDto } from './dto/listing-video.dto';

/**
 * The walkthrough on one advert.
 *
 * Singular, and owner-only. `/listings/:id/videos` (plural, in the videos
 * module) is a different thing entirely: the REELS that point at this
 * listing, which anybody can read. The tour needs no public route of its own
 * because it ships inside the listing itself, as a slide in the gallery.
 */
@ApiTags('Listings')
@ApiBearerAuth('access-token')
@Controller('listings/:id/video')
@UseGuards(JwtAccessGuard, PhoneRequiredGuard)
export class ListingVideoController {
  constructor(private readonly videos: ListingVideosService) {}

  @ApiOperation({
    summary: "This listing's tour, as its owner sees it",
    description:
      'Includes one that is still encoding or has failed, which the public listing response leaves out. This is what an editor polls while a video is being processed.',
  })
  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.forOwner(id, user.sub);
  }

  @ApiOperation({
    summary: 'Start uploading a tour',
    description:
      "Returns a signed tus ticket; the file goes from the phone straight to Bunny and never through this server. Replaces whatever tour the listing already had — one per listing. Free: the tour is part of an advert that has already been paid for, so unlike a reel there is nothing to charge and nothing to wait for.",
  })
  @Post('upload')
  createUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateListingVideoDto,
  ) {
    return this.videos.createUploadTicket(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Remove the tour',
    description:
      'Deletes the row and the file at Bunny. Nothing is retained: a tour is a photo of the property, not a published post somebody may need to justify later.',
  })
  @Delete()
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.remove(id, user.sub);
  }
}
