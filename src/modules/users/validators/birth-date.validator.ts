import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { MAX_AGE, MIN_AGE, ageFrom } from '../user-profile.constants';

/**
 * A birth date that could belong to a person using this app.
 *
 * `IsDateString` alone accepts 1823 and next Tuesday. Both get stored happily
 * and then show up as an age of 203 or −1 on a profile and in the dashboard's
 * demographics, where nobody can tell a typo from a real value any more.
 */
export function IsRealisticBirthDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isRealisticBirthDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;

          const age = ageFrom(value);
          return age !== null && age >= MIN_AGE && age <= MAX_AGE;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a real date of birth (age ${MIN_AGE}–${MAX_AGE})`;
        },
      },
    });
  };
}
