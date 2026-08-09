import { ValidPolygon } from '../validators/valid-polygon.validator';
import { ApiPolygonCoordinates } from '../decorators/api-polygon-coordinates.decorator';
import type { PolygonCoordinates } from '../types/geojson.type';

export class UpdateGeometryDto {
  @ApiPolygonCoordinates()
  @ValidPolygon({ message: 'Invalid property outline' })
  coordinates: PolygonCoordinates;
}
