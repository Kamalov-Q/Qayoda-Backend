import { ApiProperty } from '@nestjs/swagger';

/** Tashkent city block — a closed 4-point ring inside the accepted bounds. */
const EXAMPLE_RING = [
  [69.2401, 41.3111],
  [69.2455, 41.3111],
  [69.2455, 41.3155],
  [69.2401, 41.3111],
];

/**
 * `PolygonCoordinates` is a bare `number[][][]` alias, so `emitDecoratorMetadata`
 * gives Swagger nothing but `Array`. The nested schema has to be spelled out, and
 * both DTOs carrying an outline need the identical one.
 */
export const ApiPolygonCoordinates = () =>
  ApiProperty({
    description: [
      'GeoJSON Polygon coordinates: outer ring first, then any holes.',
      'Each point is `[lng, lat]` (GeoJSON axis order, **not** `[lat, lng]`).',
      '',
      'The outer ring must have at least 4 points, be closed (last point identical to the first), and lie within Uzbekistan.',
    ].join('\n'),
    type: 'array',
    items: {
      type: 'array',
      items: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
      },
      minItems: 4,
    },
    minItems: 1,
    example: [EXAMPLE_RING],
  });
