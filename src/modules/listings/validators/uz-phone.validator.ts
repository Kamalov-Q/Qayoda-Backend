import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Operator prefixes actually in service (Beeline, Ucell, UMS/Mobiuz,
 * Uzmobile, Perfectum, Humans). `9\d` covers the whole 90–99 range.
 *
 * Kept in step with mobile/src/lib/phone.ts, which applies the same rule
 * before a number is ever sent.
 */
const UZ_MOBILE = /^\+998(20|33|50|55|77|88|9\d)\d{7}$/;

/**
 * A reachable Uzbek mobile number, in the one shape the product stores:
 * +998XXXXXXXXX.
 *
 * `@MaxLength(20)` was the only rule here before, which let through anything
 * from an empty string to a sentence — a contact number nobody can ring is
 * worse than no number at all, because the listing looks contactable.
 *
 * Deliberately strict about format rather than lenient: the clients mask the
 * field as the user types and normalise before sending, so a value arriving
 * in any other shape did not come from a client this product ships.
 */
export function IsUzPhone(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isUzPhone',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          // Absence is the optional decorator's business, not this one's.
          if (value === undefined || value === null || value === '') {
            return true;
          }
          return typeof value === 'string' && UZ_MOBILE.test(value);
        },
        defaultMessage(): string {
          return 'contactPhone must be a valid Uzbek mobile number (+998XXXXXXXXX)';
        },
      },
    });
  };
}
