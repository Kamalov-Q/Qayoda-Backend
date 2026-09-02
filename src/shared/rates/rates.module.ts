import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  imports: [HttpModule.register({ timeout: 10_000 })],
  controllers: [RatesController],
  providers: [RatesService],
  exports: [RatesService],
})
export class RatesModule {}
