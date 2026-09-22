import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  Matches,
  IsIn,
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
import { CATEGORY_SLUG } from '../../categories/categories.constants';
import { ValidPolygon } from '../validators/valid-polygon.validator';
import { NotAboveTotalFloors } from '../validators/floors.validator';
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
    description:
      'USD or UZS — the price is stored as entered and normalised to USD for filtering.',
  })
  @MaxLength(3)
  @IsIn(['USD', 'UZS'])
  currency: 'USD' | 'UZS';
}

export class CreateListingDto {
  @ApiProperty({
    example: 'APARTMENT',
    description:
      'A category slug from GET /categories. Categories are managed by admins, so the set is not fixed; an unknown or hidden one is refused with CATEGORY_UNKNOWN.',
  })
  @Matches(CATEGORY_SLUG, { message: 'category must be a category slug' })
  category: string;

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
      'for categories with `floorCapable` (see GET /categories); omit it for a ' +
      'single-storey property of any category.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FLOOR)
  @Max(MAX_FLOORS)
  @NotAboveTotalFloors()
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
    isArray: true,
    type: String,
    example: ['REPAIRED', 'FURNISHED', 'AC'],
    description:
      'Amenity keys from GET /amenities (admin-managed). Unknown keys are refused with UNKNOWN_AMENITY. The clients render the uz/ru labels the catalogue carries.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  properties?: string[];

  @ApiPropertyOptional({ example: '+998901234567', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiPolygonCoordinates()
  @IsOptional()
  @ValidPolygon({ message: 'Invalid property outline' })
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
      'Floor area in m². With `point` it is the only source of the area. With `coordinates` it is optional: sent, it overrides the boundary-derived figure (an outline is an estimate); omitted, the area is computed from the boundary.',
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
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ImageInputDto)
  images?: ImageInputDto[];
}
