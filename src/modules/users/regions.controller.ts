import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UZ_REGIONS } from './uzbekistan';

/**
 * The regions a profile can say it is in.
 *
 * Served rather than bundled so the app and the dashboard cannot disagree
 * with the server about which codes are valid — the same reason the price
 * list is an endpoint. Static, public, and safe to cache for a long time:
 * Uzbekistan does not gain a region often.
 */
@ApiTags('Reference')
@Controller('regions')
export class RegionsController {
  @ApiOperation({
    summary: 'Regions and districts of Uzbekistan',
    description:
      'Fourteen regions, each with its districts nested. `code` is the ' +
      "official SOATO classifier, which is what a profile's `address` " +
      'stores — either a region code or a district code, since a district ' +
      "code nests under its region's. Tashkent city comes first; the rest " +
      'are alphabetical.',
  })
  @Get()
  list() {
    return UZ_REGIONS;
  }
}
