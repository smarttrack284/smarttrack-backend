import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365) // Set a reasonable upper limit
  expiresInDays: number | null
}