import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatesService } from './rates.service';

@ApiTags('Rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @ApiOperation({
    summary: 'Current USD/UZS rate',
    description:
      "The Central Bank of Uzbekistan's daily rate, cached server-side. Clients use it to render every price in the viewer's preferred currency. `updatedAt` is null until the first successful fetch after boot.",
  })
  @Get()
  current() {
    return this.rates.current();
  }
}
