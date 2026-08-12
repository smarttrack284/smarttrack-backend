import {
    IsString,
    MinLength,
    IsNotEmpty,
    Validate
} from "class-validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty({ message: "Current password is required." })
    currentPassword: string;

    @IsString()
    @IsStrongPassword()
    newPassword: string;
}
