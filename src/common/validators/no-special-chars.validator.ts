import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

interface NoSpecialCharsOptions {
  /** Optional custom regex pattern. Default is ASCII letters, digits, space, hyphen, underscore. */
  pattern?: RegExp;
  message?: string;
}

export function NoSpecialChars(
  options?: NoSpecialCharsOptions & ValidationOptions,
): PropertyDecorator {
  const { pattern, message, ...validationOptions } = options ?? {};
  const defaultPattern = /^[a-zA-Z0-9\-_ ]+$/;

  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'noSpecialChars',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any): boolean {
          if (typeof value !== 'string') return false;
          const regex = pattern ?? defaultPattern;
          return regex.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return message ?? `${args.property} contains invalid characters`;
        },
      },
    });
  };
}
