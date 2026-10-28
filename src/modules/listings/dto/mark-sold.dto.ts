import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsPositive, Max } from 'class-validator';
import { OfferPurpose } from '../enums/offer-purpose.enum';

/** The two the app quotes in. Same pair the offers and bids accept. */
export const SALE_CURRENCIES = ['UZS', 'USD'] as const;

/**
 * What it sold for.
 *
 * Required, not optional. The whole point of asking is the comparison
 * against the asking price, and a nullable answer makes that comparison a
 * sample of whoever felt like replying — which is worse than no data,
 * because it looks like data.
 */
export class MarkSoldDto {
  @ApiProperty({
    example: 54000,
    description:
      'The agreed price. In `currency`, not normalised — the server converts.',
  })
  @IsPositive()
  // A so'm sale runs to eleven digits, and the column is numeric(14,2). This
  // is the ceiling that fits rather than an opinion about property prices.
  @Max(999_999_999_999)
  amount: number;

  @ApiPropertyOptional({
    enum: SALE_CURRENCIES,
    default: 'UZS',
    description: 'Defaults to the currency the matching offer was quoted in.',
  })
  @IsOptional()
  @IsIn(SALE_CURRENCIES)
  currency?: (typeof SALE_CURRENCIES)[number];

  @ApiPropertyOptional({
    enum: OfferPurpose,
    description:
      'Which offer sold. Defaults to the listing’s only active offer, and is required when it has more than one — comparing a sale against a rent asking price is not a comparison.',
  })
  @IsOptional()
  @IsEnum(OfferPurpose)
  purpose?: OfferPurpose;
}
