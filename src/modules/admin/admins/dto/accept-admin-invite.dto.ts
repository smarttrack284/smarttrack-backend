import { IsNotEmpty, IsString, MinLength } from "class-validator";
import { NoSpecialChars } from "#/common/validators/no-special-chars.validator";
import { IsStrongPassword } from "#/common/decorators/validate-password.decorator";

export class AcceptAdminInviteDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @MinLength(2)
    @NoSpecialChars({
        pattern: /^[\p{L}0-9\s\-'.]+$/u,
        message: "Full name contains invalid characters"
    })
    fullName: string;

    @IsString()
    @IsStrongPassword()
    password: string;
}
