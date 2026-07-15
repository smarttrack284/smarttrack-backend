import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DispatchOrdersDto {
  @IsUUID()
  driverUserId: string;

  /** Order IDs in the exact sequence the driver should visit them. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  orderIds: string[];
}