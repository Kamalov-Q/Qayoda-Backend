import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ListingsGeoService } from './listings-geo.service';
import { MapViewportQueryDto } from './dto/map-viewport.query.dto';
import { ErrorResponse } from '../iam/responses/error.response';
import { POLYGON_ZOOM_THRESHOLD } from './listings.constants';

@ApiTags('Listings')
@Controller('listings/map')
export class ListingsMapController {
  constructor(private readonly geo: ListingsGeoService) {}

  @ApiOperation({
    summary: 'Listings in the current map viewport',
    description: [
      'Public endpoint returning active listings whose geometry intersects the given bounding box.',
      '',
      `The shape depends on \`zoom\`: below ${POLYGON_ZOOM_THRESHOLD} you get \`{ mode: "points" }\` with one centroid per listing (up to 1000), at ${POLYGON_ZOOM_THRESHOLD} and above \`{ mode: "polygons" }\` with full outlines (up to 500, newest first).`,
    ].join('\n'),
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'Query parameters failed validation.',
  })
  @Get()
  getViewport(@Query() query: MapViewportQueryDto) {
    return this.geo.getViewport(query);
  }
}
