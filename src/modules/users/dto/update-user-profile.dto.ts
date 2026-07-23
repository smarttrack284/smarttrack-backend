import {
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    IsPhoneNumber
} from "class-validator";

export class UpdateUserProfileDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(255)
    name?: string;

    @IsOptional()
    @IsPhoneNumber()
    phone?: string;
}
