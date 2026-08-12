import {
    IsEmail,
    IsNotEmpty,
    IsString,
    MinLength,
    Validate
} from "class-validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class ResetPasswordDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @IsStrongPassword()
    newPassword: string;
}
