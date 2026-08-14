import { IsUUID } from 'class-validator';

export class SendPasswordResetDto {
  @IsUUID()
  userId: string;
}
