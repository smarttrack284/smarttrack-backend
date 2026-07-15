import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class OrderItemDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
