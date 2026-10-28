import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BuildingType,
  RepairType,
  SellerType,
} from '../enums/seller-type.enum';
import { OfferPurpose } from '../enums/offer-purpose.enum';
import { Type } from 'class-transformer';
import { CATEGORY_SLUG } from '../../categories/categories.constants';
import { ValidPolygon } from '../validators/valid-polygon.validator';
import { NotAboveTotalFloors } from '../validators/floors.validator';
import { IsUzPhone } from '../validators/uz-phone.validator';
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
  // The clients apply a per-purpose, per-currency band (a daily rate and a
  // sale price differ by four orders of magnitude). This is only the outer
  // wall: 10^13 is above any real UZS sale price and below the point where a
  // number stops surviving a round trip through JSON.
  @Max(10_000_000_000_000)
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
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({
    example: '<p>Renovated, south-facing, close to the metro.</p>',
    description:
      'Rich-text description. The plain-text version used for search is derived from this server-side.',
  })
  @IsOptional()
  @IsString()
  // Was unbounded, which made a listing body an open-ended write into the
  // row — and into every search index derived from it. 8000 leaves room for
  // the markup around the clients' 2000-character limit.
  @MaxLength(8000)
  descriptionHtml?: string;

  @ApiPropertyOptional({ type: 'integer', example: 3, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  rooms?: number;

  @ApiPropertyOptional({
    enum: SellerType,
    description:
      'Who is behind the advert: the owner, or an agent acting for them.',
  })
  @IsOptional()
  @IsEnum(SellerType)
  sellerType?: SellerType;

  @ApiPropertyOptional({
    enum: RepairType,
    description:
      'State of repair, from NEEDS_REPAIR to CAPITAL. Optional — a seller who does not say is not the same as one who says "needs work".',
  })
  @IsOptional()
  @IsEnum(RepairType)
  repairType?: RepairType;

  @ApiPropertyOptional({
    enum: BuildingType,
    description:
      'New build or resale. Meaningless for land, so it is optional and left null there.',
  })
  @IsOptional()
  @IsEnum(BuildingType)
  buildingType?: BuildingType;

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
  @IsUzPhone()
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
  // 1000 ha — large farmland, nothing bigger. Mirrors MAX_AREA_M2 in the app.
  @Max(10_000_000)
  areaM2?: number;

  @ApiProperty({
    type: [OfferInputDto],
    minItems: 1,
    description:
      'At least one offer is required — a listing cannot be published without a price. One offer per purpose: a listing cannot be for sale at two different prices.',
  })
  @IsArray()
  @ArrayMinSize(1)
  // One per purpose, enforced here because the database enforces it too.
  // Without this the duplicate reached Postgres, broke a unique index and
  // came back as a 500 — after the wallet had already been charged (the
  // transaction rolled the money back, but the caller was told "Internal
  // server error" for what is a plain validation mistake).
  @ArrayUnique<OfferInputDto>((offer) => offer.purpose, {
    message: 'offers must have one entry per purpose',
  })
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
