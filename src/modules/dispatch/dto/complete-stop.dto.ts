import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProofOfDeliveryMethod } from '#/common/entities/trip-stop.entity';

export class CompleteStopDto {
  @IsEnum(ProofOfDeliveryMethod)
  podMethod: ProofOfDeliveryMethod;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}