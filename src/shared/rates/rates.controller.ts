import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatesService } from './rates.service';

@ApiTags('Rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @ApiOperation({
    summary: 'Current USD/UZS rate',
    description: [
      "The Central Bank of Uzbekistan's daily rate, cached server-side. Clients use it to render every price in the viewer's preferred currency.",
      '',
      '`source` says where the number came from: `CBU` is the official published rate; `MARKET` is a mid-market aggregate used only when cbu.uz cannot be reached (it is geo-restricted, and does not answer hosts outside Uzbekistan); `CONSTANT` is a hardcoded last resort and means both fetches have failed since boot.',
      '',
      '`isFallback` is true for anything that is not `CBU`. `updatedAt` is null until the first successful fetch of either.',
    ].join('\n'),
  })
  @Get()
  current() {
    return this.rates.current();
  }
}
