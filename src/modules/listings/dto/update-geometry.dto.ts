import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { ValidPolygon } from '../validators/valid-polygon.validator';
import { ApiPolygonCoordinates } from '../decorators/api-polygon-coordinates.decorator';
import type { PolygonCoordinates } from '../types/geojson.type';

/** Exactly one of the two shapes — the service enforces the one-of rule. */
export class UpdateGeometryDto {
  @ApiPolygonCoordinates()
  @IsOptional()
  @ValidPolygon({ message: 'Invalid property outline' })
  coordinates?: PolygonCoordinates;

  @ApiPropertyOptional({
    type: [Number],
    example: [69.2401, 41.2995],
    description: 'Approximate location as [lng, lat] — the pin alternative.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({}, { each: true })
  point?: [number, number];
}
