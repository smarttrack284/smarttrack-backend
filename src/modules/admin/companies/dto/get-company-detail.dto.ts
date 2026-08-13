import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

export class GetCompanyDetailDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamPage: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  teamPageSize: number = 10;
}