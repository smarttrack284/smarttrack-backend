import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { NoSpecialChars } from '#/common/validators/no-special-chars.validator';

export class OrderItemDto {
  @IsString()
  @MaxLength(255)
  @NoSpecialChars({
    pattern: /^[\p{L}0-9\s\-_'.()]+$/u,
    message:
      'Item name can only contain letters, numbers, spaces, hyphens, underscores, apostrophes, periods, and parentheses',
  })
  name: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
