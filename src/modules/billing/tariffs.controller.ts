import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tariff } from './entities/tariff.entity';
import { BonusTier } from './entities/bonus-tier.entity';

/**
 * The price list, as the app reads it.
 *
 * Public and unauthenticated on purpose: what posting a listing costs is not
 * a secret, and somebody deciding whether to sign up should be able to see it.
 * Only ACTIVE tariffs are listed — a retired one stays in the table so old
 * transactions still name something real, but nothing should offer it.
 *
 * The app must never hardcode these numbers. An admin changes a price in the
 * dashboard and every client picks it up on the next fetch, which is the
 * whole reason this endpoint exists rather than a constant in the bundle.
 */
@ApiTags('Billing')
@Controller('tariffs')
export class TariffsController {
  constructor(
    @InjectRepository(Tariff) private readonly tariffs: Repository<Tariff>,
    @InjectRepository(BonusTier) private readonly tiers: Repository<BonusTier>,
  ) {}

  @ApiOperation({
    summary: 'What each action costs',
    description:
      'Active tariffs, cheapest first within an action. `durationDays` is ' +
      'set only for the ones that buy time, such as LISTING_PROMOTE — an ' +
      'action can have several, one per length.',
  })
  @ApiOkResponse({ type: [Tariff] })
  @Get()
  list() {
    return this.tariffs.find({
      where: { isActive: true },
      order: { action: 'ASC', durationDays: 'ASC', price: 'ASC' },
    });
  }

  @ApiOperation({
    summary: 'Top-up bonus tiers',
    description:
      'What percentage is added for topping up at least `minAmount`. The ' +
      'app shows these on the top-up screen so the bonus is visible before ' +
      'the money moves, not after.',
  })
  @Get('bonus-tiers')
  bonusTiers() {
    return this.tiers.find({
      where: { isActive: true },
      order: { minAmount: 'ASC' },
    });
  }
}
