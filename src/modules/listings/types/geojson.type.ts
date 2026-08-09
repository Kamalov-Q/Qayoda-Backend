/** [lng, lat] — GeoJSON axis order. */
export type Position = [number, number];

/** A single closed ring: first point equals last. */
export type PolygonRing = Position[];

/** GeoJSON Polygon coordinates: outer ring first, then any holes. */
export type PolygonCoordinates = PolygonRing[];

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: PolygonCoordinates;
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: Position;
}
