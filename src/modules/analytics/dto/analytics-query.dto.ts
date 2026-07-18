import { IsOptional, IsISO8601 } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}