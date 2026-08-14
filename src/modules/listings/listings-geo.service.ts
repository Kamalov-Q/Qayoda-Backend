// listings-geo.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MapViewportQueryDto } from './dto/map-viewport.query.dto';
import type {
  GeoJsonPoint,
  GeoJsonPolygon,
  PolygonCoordinates,
} from './types/geojson.type';

import { POLYGON_ZOOM_THRESHOLD } from './listings.constants';

/**
 * `price` is a Postgres `numeric`: node-postgres hands numerics back as
 * strings from raw queries to avoid float precision loss.
 */
export interface ViewportPolygonFeature {
  id: string;
  geom: GeoJsonPolygon;
  centroid: GeoJsonPoint | null;
  title: string | null;
  rooms: number | null;
  areaM2: string | null;
  price: string;
  currency: string;
  thumbUrl: string | null;
}

export interface ViewportPointFeature {
  listingId: string;
  centroid: GeoJsonPoint;
  price: string;
  currency: string;
  thumbUrl: string | null;
}

interface GeometryCheckRow {
  valid: boolean;
  reason: string;
}

/**
 * `%` and `_` are wildcards inside ILIKE patterns, so someone literally
 * searching "12_kvartal" would otherwise match any character in the gap.
 * Parameter binding already prevents injection; this only neutralises pattern
 * metacharacters (backslash is Postgres's default ESCAPE character).
 */
function toLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

@Injectable()
export class ListingsGeoService {
  constructor(private readonly dataSource: DataSource) {}

  async getViewport(q: MapViewportQueryDto) {
    return q.zoom >= POLYGON_ZOOM_THRESHOLD
      ? { mode: 'polygons' as const, features: await this.getPolygons(q) }
      : { mode: 'points' as const, features: await this.getPoints(q) };
  }

  private async getPolygons(q: MapViewportQueryDto) {
    const params: unknown[] = [q.purpose, q.west, q.south, q.east, q.north];
    let i = params.length;
    let categoryFilter = '';
    let priceMinFilter = '';
    let priceMaxFilter = '';
    if (q.category) {
      params.push(q.category);
      categoryFilter = `AND l.category = $${++i}`;
    }
    if (q.priceMin !== undefined) {
      params.push(q.priceMin);
      priceMinFilter = `AND o.price >= $${++i}`;
    }
    if (q.priceMax !== undefined) {
      params.push(q.priceMax);
      priceMaxFilter = `AND o.price <= $${++i}`;
    }
    let addressFilter = '';
    if (q.address) {
      params.push(toLikePattern(q.address));
      addressFilter = `AND l.address ILIKE $${++i}`;
    }

    return this.dataSource.query<ViewportPolygonFeature[]>(
      `
  SELECT
    l.id,
    ST_AsGeoJSON(l.geom)::json      AS geom,
    ST_AsGeoJSON(l.centroid)::json  AS centroid,
    l.title,
    l.rooms,
    l.area_m2                        AS "areaM2",
    o.price, o.currency,
    li.thumb_url                    AS "thumbUrl"
  FROM listings l
  JOIN listing_offers o ON o.listing_id = l.id AND o.purpose = $1 AND o.is_active
  LEFT JOIN listing_images li ON li.listing_id = l.id AND li.is_primary
  WHERE l.status = 'ACTIVE'
    AND l.centroid IS NOT NULL
    AND ST_Intersects(l.geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))
    ${categoryFilter} ${priceMinFilter} ${priceMaxFilter} ${addressFilter}
  ORDER BY l.published_at DESC NULLS LAST
  LIMIT 500
  `,
      params,
    );
  }

  private async getPoints(q: MapViewportQueryDto) {
    const params: unknown[] = [q.purpose, q.west, q.south, q.east, q.north];
    let i = params.length;
    let categoryFilter = '';
    let priceMinFilter = '';
    let priceMaxFilter = '';
    if (q.category) {
      params.push(q.category);
      categoryFilter = `AND category = $${++i}`;
    }
    if (q.priceMin !== undefined) {
      params.push(q.priceMin);
      priceMinFilter = `AND price >= $${++i}`;
    }
    if (q.priceMax !== undefined) {
      params.push(q.priceMax);
      priceMaxFilter = `AND price <= $${++i}`;
    }
    let addressFilter = '';
    if (q.address) {
      params.push(toLikePattern(q.address));
      // NULL ILIKE anything is NULL, so address-less listings drop out of an
      // address search — which is the right reading of "filter by address".
      addressFilter = `AND address ILIKE $${++i}`;
    }

    return this.dataSource.query<ViewportPointFeature[]>(
      `
      SELECT
        listing_id                      AS "listingId",
        ST_AsGeoJSON(centroid)::json    AS centroid,
        price, currency,
        thumb_url                       AS "thumbUrl"
      FROM listing_map_points
      WHERE purpose = $1
        AND ST_Intersects(centroid, ST_MakeEnvelope($2, $3, $4, $5, 4326))
        ${categoryFilter} ${priceMinFilter} ${priceMaxFilter} ${addressFilter}
      LIMIT 1000
      `,
      params,
    );
  }

  /**
   * Validates GeoJSON rings in PostGIS (self-intersection etc. — second line
   * of defense behind the DTO validator) and hands back the polygon as GeoJSON.
   *
   * GeoJSON rather than WKT because that is the only shape TypeORM accepts for a
   * geography column: the driver JSON-stringifies the parameter and wraps it in
   * `ST_GeomFromGeoJSON`, so a WKT literal arrives as a quoted string and dies
   * with "unknown GeoJSON type".
   */
  async toValidatedPolygon(
    coordinates: PolygonCoordinates,
  ): Promise<GeoJsonPolygon> {
    const polygon: GeoJsonPolygon = { type: 'Polygon', coordinates };
    const rows = await this.dataSource.query<GeometryCheckRow[]>(
      `SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason
       FROM (SELECT ST_GeomFromGeoJSON($1) AS g) AS sub`,
      [JSON.stringify(polygon)],
    );
    const { valid, reason } = rows[0];
    if (!valid)
      throw new BadRequestException(`Invalid polygon geometry: ${reason}`);
    return polygon;
  }
}
