import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: string) {
          return (
            typeof value === 'string' &&
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s])[\s\S]{8,64}$/.test(
              value,
            )
          );
        },
        defaultMessage() {
          return 'Password must be 8–64 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character.';
        },
      },
    });
  };
}