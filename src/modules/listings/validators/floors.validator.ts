import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * The subset of a listing body this validator reads.
 *
 * (Whether a category may have floors at all used to be a decorator here too;
 * categories are admin-managed data now, so that rule needs the database and
 * lives in ListingsService.)
 */
type FloorsShape = {
  floor?: number | null;
  totalFloors?: number | null;
};

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
