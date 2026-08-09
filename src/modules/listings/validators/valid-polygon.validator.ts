import {
  ValidatorConstraint,
  ValidationOptions,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

import type { PolygonRing } from '../types/geojson.type';

const UZ_BOX = { minLng: 55.9, minLat: 37.1, maxLng: 73.2, maxLat: 45.6 };
type Ring = PolygonRing;

@ValidatorConstraint({ name: 'ValidPolygon', async: false })
export class ValidPolygonConstaint implements ValidatorConstraintInterface {
  private lastError = 'Invalid Polygon';

  validate(rings: Ring[]): boolean {
    if (!Array.isArray(rings) || rings.length === 0) {
      this.lastError = 'Polygon must have at least one ring';
      return false;
    }

    const outer = rings[0];
    if (!Array.isArray(outer) || outer.length < 4) {
      this.lastError = 'Outer ring must have at least 4 points';
      return false;
    }

    for (const point of outer) {
      if (!Array.isArray(point) || point.length !== 2) {
        this.lastError = 'Each point must be [lng, lat]';
        return false;
      }

      const [lng, lat] = point;
      if (
        typeof lng !== 'number' ||
        typeof lat !== 'number' ||
        Number.isNaN(lng) ||
        Number.isNaN(lat)
      ) {
        this.lastError = 'Coordinates must be numbers';
        return false;
      }

      if (
        lng < UZ_BOX.minLng ||
        lng > UZ_BOX.maxLng ||
        lat < UZ_BOX.minLat ||
        lat > UZ_BOX.maxLat
      ) {
        this.lastError = 'Coordinates must be in Uzbekistan';
        return false;
      }
    }

    const first = outer[0];
    const last = outer[outer.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1]) {
      this.lastError =
        'Ring must be closed (first point must equal last point)';
      return false;
    }
    return true;
  }

  defaultMessage(): string {
    return this.lastError;
  }
}

export function ValidPolygon(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: ValidPolygonConstaint,
    });
  };
}
