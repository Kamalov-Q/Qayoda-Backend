import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

import { PropertyCategory } from '../enums/property-category.enum';
import {
  FLOOR_CAPABLE_CATEGORIES,
  categoryHasFloors,
} from '../listings.constants';

/** The subset of a listing body these two validators read. */
type FloorsShape = {
  category?: PropertyCategory;
  floor?: number | null;
  totalFloors?: number | null;
};

/**
 * Rejects a floor sent for a category that cannot have one, so a `LAND`
 * listing can never carry "floor 3" into the database and out to the map.
 *
 * A partial update may omit the category — there the DTO has nothing to check
 * against and defers to `ListingsService.update()`, which re-runs the same rule
 * against the stored category.
 */
export function FloorAllowedForCategory(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'floorAllowedForCategory',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined || value === null) return true;
          const { category } = args.object as FloorsShape;
          if (category === undefined) return true;
          return categoryHasFloors(category);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} is only meaningful for ${FLOOR_CAPABLE_CATEGORIES.join(
            ' / ',
          )} listings`;
        },
      },
    });
  };
}

/**
 * Catches the transposed pair — "9 of 4" — which otherwise renders as a
 * plausible-looking spec on the listing page.
 *
 * Only compares when both numbers are in the same body; a lone `floor` on a
 * partial update is checked against the stored `totalFloors` in the service.
 */
export function NotAboveTotalFloors(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'notAboveTotalFloors',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const { totalFloors } = args.object as FloorsShape;
          if (typeof value !== 'number' || typeof totalFloors !== 'number') {
            return true;
          }
          return value <= totalFloors;
        },
        defaultMessage(): string {
          return 'floor cannot be above totalFloors';
        },
      },
    });
  };
}
