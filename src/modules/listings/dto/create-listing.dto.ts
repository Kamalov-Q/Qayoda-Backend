import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OfferPurpose } from '../enums/offer-purpose.enum';
import { Type } from 'class-transformer';
import { PropertyCategory } from '../enums/property-category.enum';
import { ValidPolygon } from '../validators/valid-polygon.validator';
import {
  FloorAllowedForCategory,
  NotAboveTotalFloors,
} from '../validators/floors.validator';
import { MAX_FLOORS, MIN_FLOOR } from '../listings.constants';
import { ApiPolygonCoordinates } from '../decorators/api-polygon-coordinates.decorator';
import type { PolygonCoordinates } from '../types/geojson.type';
import { ImageInputDto } from './update-images.dto';

export class OfferInputDto {
  @ApiProperty({
    enum: OfferPurpose,
    enumName: 'OfferPurpose',
    example: OfferPurpose.SALE,
    description:
      'What the listing is offered for. A listing may carry several offers (e.g. both `SALE` and `RENT_MONTHLY`), but only one per purpose.',
  })
  @IsEnum(OfferPurpose)
  purpose: OfferPurpose;

  @ApiProperty({
    example: 850000000,
    minimum: 0,
    description:
      'Total price for `SALE`, or the price per month/day for the rental purposes.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    example: 'UZS',
    maxLength: 3,
    description: 'ISO 4217 currency code.',
  })
  @IsString()
  @MaxLength(3)
  currency: string;
}

export class CreateListingDto {
  @ApiProperty({
    enum: PropertyCategory,
    enumName: 'PropertyCategory',
    example: PropertyCategory.APARTMENT,
  })
  @IsEnum(PropertyCategory)
  category: PropertyCategory;

  @ApiPropertyOptional({
    example: '3-room apartment near Chorsu',
    maxLength: 160,
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({
    example: '<p>Renovated, south-facing, close to the metro.</p>',
    description:
      'Rich-text description. The plain-text version used for search is derived from this server-side.',
  })
  @IsOptional()
  @IsString()
  descriptionHtml?: string;

  @ApiPropertyOptional({ type: 'integer', example: 3, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rooms?: number;

  @ApiPropertyOptional({
    type: 'integer',
    example: 4,
    minimum: MIN_FLOOR,
    maximum: MAX_FLOORS,
    description:
      'Floor the unit is on. May be negative for basement levels. Accepted only ' +
      'for the categories that can be stacked (`APARTMENT`, `BUILDING`); omit it ' +
      'for a single-storey property of any category.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FLOOR)
  @Max(MAX_FLOORS)
  @NotAboveTotalFloors()
  @FloorAllowedForCategory()
  floor?: number;

  @ApiPropertyOptional({
    type: 'integer',
    example: 9,
    minimum: 1,
    maximum: MAX_FLOORS,
    description:
      'Storeys in the building. Same category rule as `floor`, and the two are ' +
      'independent — a top-floor flat in an unknown-height block may send `floor` alone.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FLOORS)
  @FloorAllowedForCategory()
  totalFloors?: number;

  @ApiPropertyOptional({
    example: 'Tashkent, Shayxontohur district, Navoi str. 12',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    example: 'Metro Chilonzor yonida',
    description:
      'A wayfinding landmark, typed by the owner. The address itself is derived from the drawn boundary.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  landmark?: string;

  @ApiPropertyOptional({ example: '+998901234567', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiPolygonCoordinates()
  @IsOptional()
  @ValidPolygon({ message: 'Invalida property outline' })
  coordinates?: PolygonCoordinates;

  @ApiPropertyOptional({
    type: [Number],
    example: [69.2401, 41.2995],
    description:
      'Approximate location as [lng, lat] — the pin alternative to a drawn boundary. Exactly one of `coordinates` or `point` must be sent.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  point?: [number, number];

  @ApiPropertyOptional({
    example: 78.5,
    minimum: 0,
    description:
      'Floor area in m². Accepted ONLY together with `point` — polygon listings derive it from the drawn boundary and ignore this field.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  areaM2?: number;

  @ApiProperty({
    type: [OfferInputDto],
    minItems: 1,
    description:
      'At least one offer is required — a listing cannot be published without a price.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfferInputDto)
  offers: OfferInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => ImageInputDto)
  images?: ImageInputDto[];
}
