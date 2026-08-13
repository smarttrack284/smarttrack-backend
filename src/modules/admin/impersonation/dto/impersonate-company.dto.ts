import { IsOptional, IsUUID } from 'class-validator';

export class ImpersonateCompanyDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}