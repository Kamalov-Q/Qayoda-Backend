import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfferPurpose } from '../../listings/enums/offer-purpose.enum';

/** The currencies an asking price may be in, and so the ones a bid may be in. */
export const BID_CURRENCIES = ['USD', 'UZS'] as const;

export class CreatePriceBidDto {
  @ApiProperty({
    example: 25065,
    minimum: 1,
    description:
      'The amount offered, in `currency`. An absolute number, never a percentage — the −5/−10/−15% chips in the app are input helpers and the discount they imply stops being true the moment the seller edits the asking price.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    enum: BID_CURRENCIES,
    default: 'USD',
    description: 'Defaults to the currency of the asking price being bid on.',
  })
  @IsOptional()
  @IsIn(BID_CURRENCIES)
  currency?: string;

  @ApiPropertyOptional({
    enum: OfferPurpose,
    enumName: 'OfferPurpose',
    description:
      'Which asking price this is against. Defaults to the listing’s only active offer, and is required when it has more than one.',
  })
  @IsOptional()
  @IsEnum(OfferPurpose)
  purpose?: OfferPurpose;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Naqd pulga, shu hafta.',
    description:
      'A line that rides along into the chat thread with the bid. Optional, and the thing that makes a low number readable.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
