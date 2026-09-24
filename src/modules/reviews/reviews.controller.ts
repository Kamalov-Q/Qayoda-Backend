import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { ReviewsService } from './reviews.service';
import {
  AdminReviewsQueryDto,
  ReviewsQueryDto,
  UpsertReviewDto,
} from './dto/review.dto';

@ApiTags('Listings')
@Controller('listings/:id/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({
    summary: 'Reviews for a listing, with the rating summary',
    description:
      'Public — anyone can read reviews. Returns one page of reviews (newest first), the average, the five-star histogram, and, for a signed-in caller, their own review under `mine` so the screen can offer "edit" rather than a second review. Sending a token is optional and only changes `mine`.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  list(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReviewsQueryDto,
  ) {
    return this.reviews.list(id, user?.sub ?? null, query);
  }

  @ApiOperation({
    summary: 'Leave or edit your review',
    description:
      'One review per person per listing: calling this again replaces the one you left, so the client does not need a separate edit call. Owners cannot review their own listing (403 OWN_LISTING). `rating` is 1–5; `comment` is optional.',
  })
  @ApiBearerAuth('access-token')
  // Phone gate: this is one of the actions other people have to live with,
  // so it needs an account answerable at a verified number. Telegram/Google
  // sign-ins without one get 403 PHONE_REQUIRED and the app opens the
  // add-a-number flow.
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Put('mine')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertReviewDto,
  ) {
    return this.reviews.upsert(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Withdraw your review',
    description: 'Idempotent — deleting a review you never left succeeds.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete('mine')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.remove(id, user.sub);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/reviews')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({
    summary: 'All reviews, newest first, with listing and author',
    description:
      'Filterable down to the ones worth reading: `maxRating` for the complaints, `withText` for the ones that say something.',
  })
  @Get()
  list(@Query() query: AdminReviewsQueryDto) {
    return this.reviews.adminList(query);
  }

  @ApiOperation({
    summary: 'Delete a review',
    description:
      "For abuse, not for opinions — the listing's average is recomputed immediately.",
  })
  @Delete(':reviewId')
  remove(@Param('reviewId', ParseUUIDPipe) reviewId: string) {
    return this.reviews.adminRemove(reviewId);
  }
}
