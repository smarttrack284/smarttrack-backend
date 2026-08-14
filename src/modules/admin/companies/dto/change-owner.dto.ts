import { IsUUID } from 'class-validator';

export class ChangeOwnerDto {
  @IsUUID()
  newOwnerUserId: string;
}
