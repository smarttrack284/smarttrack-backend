import { IsOptional, IsBoolean } from "class-validator";

export class UpdateCompanyNotificationDto {
    @IsOptional()
    @IsBoolean()
    customerEmailEnabled?: boolean;

    @IsOptional()
    @IsBoolean()
    teamEmailEnabled?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderCreated?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderAssigned?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderPickedUp?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderInTransit?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderDelivered?: boolean;

    @IsOptional()
    @IsBoolean()
    customerEmailOrderCancelled?: boolean;
    
    @IsOptional()
    @IsBoolean()
    customerEmailOrderFailed?: boolean;
}
