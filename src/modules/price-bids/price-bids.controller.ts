import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { PriceBidsService } from './price-bids.service';
import { CreatePriceBidDto } from './dto/create-price-bid.dto';
import { ListPriceBidsDto } from './dto/list-price-bids.dto';
import { RespondPriceBidDto } from './dto/respond-price-bid.dto';

/**
 * Everything here is signed-in only. A bid is a claim on somebody's
 * attention with their phone number attached to the other end of it, and an
 * anonymous one is spam with extra steps.
 */
@ApiTags('Price bids')
@ApiBearerAuth('access-token')
@UseGuards(JwtAccessGuard)
@Controller()
export class PriceBidsController {
  constructor(private readonly bids: PriceBidsService) {}

  @ApiOperation({
    summary: 'Offer a price on a listing',
    description:
      'Posts the offer into the buyer’s thread with the seller, opening one if there is none. Supersedes the caller’s own open offer on the same listing. 400 if the listing is not ACTIVE, is the caller’s own, has no price, or has several and none was named; 403 if either party has blocked the other.',
  })
  @Post('listings/:id/bids')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePriceBidDto,
  ) {
    return this.bids.create(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Offers on a listing',
    description:
      'The owner sees every offer. Anybody else sees only their own — a public count of what has been bid tells the next buyer exactly what to beat.',
  })
  @Get('listings/:id/bids')
  listForListing(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ListPriceBidsDto,
  ) {
    return this.bids.listForListing(id, user.sub, q);
  }

  @ApiOperation({
    summary: 'Your negotiations, both sides',
    description:
      'Offers you have made AND offers made on your adverts, newest first. Each row carries a snippet of the listing it is against — the title alone makes a column of amounts readable.',
  })
  @Get('me/bids')
  listMine(@CurrentUser() user: AuthUser, @Query() q: ListPriceBidsDto) {
    return this.bids.listMine(user.sub, q);
  }

  @ApiOperation({
    summary: 'One offer',
    description: 'Participants only. This is what the card in the chat reads.',
  })
  @Get('bids/:id')
  getOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bids.getOne(id, user.sub);
  }

  @ApiOperation({
    summary: 'Offers behind a page of chat messages',
    description:
      'Comma-separated ids, at most 100. One round trip for a thread rather than one per card. Ids the caller is not party to are dropped silently rather than refused — a thread may legitimately contain none of theirs.',
  })
  @Get('bids')
  getMany(@CurrentUser() user: AuthUser, @Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return this.bids.getManyForUser(list, user.sub);
  }

  @ApiOperation({
    summary: 'Accept an offer',
    description:
      'Agrees the NUMBER and nothing else: no money moves, nothing is reserved, the listing does not change. Answerable only by the side that did not make it.',
  })
  @Post('bids/:id/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondPriceBidDto,
  ) {
    return this.bids.accept(id, user.sub, dto.note);
  }

  @ApiOperation({ summary: 'Decline an offer' })
  @Post('bids/:id/decline')
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondPriceBidDto,
  ) {
    return this.bids.decline(id, user.sub, dto.note);
  }

  @ApiOperation({
    summary: 'Counter with a number of your own',
    description:
      'Settles the offer being answered as COUNTERED and creates a new open one pointing back at it.',
  })
  @Post('bids/:id/counter')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePriceBidDto,
  ) {
    return this.bids.counter(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Take your own offer back',
    description: 'Author only, and silent — the other side is not notified.',
  })
  @Delete('bids/:id')
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bids.withdraw(id, user.sub);
  }
}
