import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SkipReasonCode } from '#/common/constants/stop-status.constant';

export class SkipStopDto {
  @IsEnum(SkipReasonCode)
  reason: SkipReasonCode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}