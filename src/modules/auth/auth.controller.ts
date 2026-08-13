import {
    Body,
    Controller,
    Get,
    Logger,
    Post,
    Query,
    Req,
    Res,
    UseGuards
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import { SupabaseAuthGuard } from "#/common/guards/supabase-auth.guard";
import { CurrentUser } from "#/common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";
import { LogInDto } from "#/modules/auth/dto/login.dto";
import { SignUpDto } from "#/modules/auth/dto/sign-up.dto";
import { ChangePasswordDto } from "#/modules/auth/dto/change-password.dto";
import { ResendConfirmationDto } from "#/modules/auth/dto/resend-confirmation.dto";
import { VerifyOtpDto } from "#/modules/auth/dto/verify-otp.dto";
import { VerifyResetTokenDto } from "#/modules/auth/dto/verify-reset-token.dto";
import { ResetPasswordDto } from "#/modules/auth/dto/reset-password.dto";
import { ForgotPasswordDto } from "#/modules/auth/dto/forgot-password.dto";
import {
    BadRequestAppException,
    ForbiddenAppException
} from "#/common/exceptions";
import { ConfigService } from "@nestjs/config";
import {
    AuthThrottle,
    PublicThrottle
} from "#/common/decorators/throttle.decorator";

@AuthThrottle()
@Controller("auth")
export class AuthController {
    private logger: Logger = new Logger(AuthController.name);
    constructor(
        private readonly authService: AuthService,
        private readonly config: ConfigService
    ) {}

    @Post("login")
    async login(@Body() dto: LogInDto, @Res() reply: FastifyReply) {
        if (dto.website && dto.website.trim().length > 0) {
            throw new ForbiddenAppException("Security verification failed.");
        }

        const { session } = await this.authService.login(
            dto.email,
            dto.password,
            dto.captchaToken
        );
        this.setCookies(
            reply,
            session.access_token,
            session.refresh_token,
            session.expires_in
        );
        reply.send({ success: true });
    }

    @Post("signup")
    async signup(@Body() dto: SignUpDto, @Res() reply: FastifyReply) {
        if (dto.website && dto.website.trim().length > 0) {
            throw new ForbiddenAppException("Security verification failed.");
        }

        const result = await this.authService.signup(
            dto.email,
            dto.password,
            dto.fullName,
            dto.captchaToken
        );

        // Only set cookies if a session was returned (email already confirmed)
        if (result.session) {
            this.setCookies(
                reply,
                result.session.access_token,
                result.session.refresh_token,
                result.session.expires_in
            );
        }

        reply.send({ success: true, message: result.message });
    }

    @Post("logout")
    @UseGuards(SupabaseAuthGuard)
    async logout(
        @CurrentUser() user: AuthenticatedUser,
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        // Revoke the session in Redis
        await this.authService.revokeSession(user.sessionId, user.id);
        // Clear cookies
        this.clearCookies(request, reply);
        reply.send({ success: true });
    }

    @Post("change-password")
    @UseGuards(SupabaseAuthGuard)
    async changePassword(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: ChangePasswordDto,
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        await this.authService.changePassword(
            user.id,
            dto.currentPassword,
            dto.newPassword
        );
        // Optionally reissue a new session
        this.clearCookies(request, reply);
        reply.send({ success: true });
    }

    @Post("resend-confirmation")
    async resendConfirmation(@Body() dto: ResendConfirmationDto) {
        await this.authService.resendConfirmation(dto.email);
        return { success: true };
    }

    @Post("verify-otp")
    async verifyOtp(@Body() dto: VerifyOtpDto, @Res() reply: FastifyReply) {
        const result = await this.authService.verifyOtp(
            dto.email,
            dto.token,
            dto.type
        );
        if (result.session) {
            this.setCookies(
                reply,
                result.session.access_token,
                result.session.refresh_token,
                result.session.expires_in
            );
        }
        reply.send({ success: true });
    }

    @Post("verify-reset-token")
    async verifyResetToken(@Body() dto: VerifyResetTokenDto) {
        await this.authService.verifyResetToken(dto.email, dto.token);
        return { success: true };
    }

    @Post("reset-password")
    async resetPassword(
        @Body() dto: ResetPasswordDto,
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        await this.authService.resetPassword(
            dto.email,
            dto.token,
            dto.newPassword
        );
        this.clearCookies(request, reply);
        return { success: true };
    }

    @Post("forgot-password")
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        if (dto.website && dto.website.trim().length > 0) {
            throw new ForbiddenAppException("Security verification failed.");
        }
        return this.authService.forgotPassword(dto.email, dto.captchaToken);
    }

    @Get("me")
    @UseGuards(SupabaseAuthGuard)
    @PublicThrottle()
    async me(@CurrentUser() user: AuthenticatedUser) {
        // The guard already enriches the request; return it directly
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            companyId: user.companyId,
            role: user.role,
            avatarUrl: user.avatarUrl
        };
    }

    @Get("google")
    @PublicThrottle()
    async googleAuth(
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        const authUrl = await this.authService.getGoogleAuthUrl(request, reply);
        reply.redirect(authUrl, 302);
    }

    @Get("google/callback")
    async googleCallback(
        @Query("code") code: string,
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        if (!code) {
            throw new BadRequestAppException("Missing authorization code");
        }
        try {
            const { accessToken, refreshToken, expiresIn } =
                await this.authService.exchangeCodeForSession(
                    code,
                    request,
                    reply
                );

            // Explicitly set our custom cookie aliases so the rest of the app can read them
            this.setCookies(reply, accessToken, refreshToken, expiresIn);

            reply.redirect(`${this.config.get("CLIENT_URL")}/callback`, 302);
        } catch (err) {
            this.logger.error({
                msg: "Google OAuth callback failed",
                err: (err as Error).message,
                stack: (err as Error).stack
            });
            reply.redirect(
                `${this.config.get("CLIENT_URL")}/log-in?error=auth_failed`,
                302
            );
        }
    }

    private setCookies(
        reply: FastifyReply,
        accessToken: string,
        refreshToken: string,
        expiresIn: number
    ) {
        const isProd = process.env.NODE_ENV === "production";
        reply.setCookie("sb-access-token", accessToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: "strict",
            path: "/",
            maxAge: expiresIn // seconds
        });
        reply.setCookie("sb-refresh-token", refreshToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: "strict",
            path: "/",
            maxAge: 60 * 60 * 24 * 30 // 30 days
        });
    }

    private clearCookies(req: FastifyRequest, reply: FastifyReply) {
        // Clear every cookie that starts with "sb-" (Supabase default prefix)
        const cookieNames = Object.keys(req.cookies);
        for (const name of cookieNames) {
            if (name.startsWith("sb-")) {
                reply.clearCookie(name, { path: "/" });
            }
        }
    }
}
