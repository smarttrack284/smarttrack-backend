import {
    IsString,
    MinLength,
    IsNotEmpty,
} from "class-validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class UpdatePasswordDto {
    @IsString()
    @IsNotEmpty({ message: "Current password is required." })
    currentPassword: string;

    @IsString()
    @IsStrongPassword()
    newPassword: string;
}
