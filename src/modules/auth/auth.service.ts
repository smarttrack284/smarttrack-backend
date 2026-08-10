import { Inject, Injectable, Logger } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
    BadRequestAppException,
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";
import { SUPABASE_CLIENT } from "#/common/constants/supabase.constant";
import {
    ErrorHandlerService,
    rule
} from "#/common/errors/error-handler.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { ConfigService } from "@nestjs/config";
import { FastifyReply, FastifyRequest } from "fastify";
import { createServerClient } from "@supabase/ssr";

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly backendUrl;
    private readonly supabasePublishable;
    private readonly supabaseUrl;
    private readonly supabaseAnon: SupabaseClient; // anon key (for OAuth)

    constructor(
        @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient,
        private readonly errorHandler: ErrorHandlerService,
        private readonly cache: RedisCacheService,
        private readonly config: ConfigService
    ) {
        this.backendUrl = this.config.get<string>("BACKEND_URL")!;
        this.supabaseUrl = this.config.get<string>("SUPABASE_URL")!;
        this.supabasePublishable = this.config.get<string>(
            "SUPABASE_PUBLISHABLE_KEY"
        )!;

        this.supabaseAnon = createClient(
            this.supabaseUrl,
            this.config.get<string>("SUPABASE_ANON_KEY")!
        );
    }

    async login(email: string, password: string) {
        try {
            const { data, error } =
                await this.supabaseAdmin.auth.signInWithPassword({
                    email,
                    password
                });
            if (error || !data.session) {
                throw new UnauthorizedAppException("Invalid credentials");
            }
            return { session: data.session };
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.login", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to log in. Please try again."
                        )
                )
            ]);
        }
    }

    async signup(email: string, password: string, fullName: string) {
        try {
            const { data, error } = await this.supabaseAdmin.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });
            if (error) {
                throw new BadRequestAppException(error.message);
            }
            // If email confirmation is enabled, session will be null.
            // We always return an object with a session property (nullable).
            return {
                session: data.session ?? null,
                message: data.session
                    ? undefined
                    : "Please check your email to confirm your account."
            };
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.signup", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to create account. Please try again."
                        )
                )
            ]);
        }
    }

    async changePassword(
        userId: string,
        currentPassword: string,
        newPassword: string
    ) {
        try {
            // Fetch user email first (needed for sign-in verification)
            const { data: userData, error: userError } =
                await this.supabaseAdmin.auth.admin.getUserById(userId);
            if (userError || !userData?.user?.email) {
                throw new BadRequestAppException(
                    "Unable to change password. Please try again later."
                );
            }

            // Verify current password by attempting sign-in
            const { error: signInError } =
                await this.supabaseAdmin.auth.signInWithPassword({
                    email: userData.user.email,
                    password: currentPassword
                });
            if (signInError) {
                throw new UnauthorizedAppException(
                    "Current password is incorrect"
                );
            }

            // Update to new password – map any Supabase error to a safe message
            const { error: updateError } =
                await this.supabaseAdmin.auth.admin.updateUserById(userId, {
                    password: newPassword
                });
            if (updateError) {
                // Never expose the raw Supabase error to the client
                throw new BadRequestAppException(
                    "Unable to change password. Please ensure your new password meets the requirements."
                );
            }
        } catch (err) {
            // Any unexpected error (network, etc.) will be caught here and mapped to a generic 500
            this.errorHandler.handle(err, "AuthService.changePassword", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to change password. Please try again."
                        )
                )
            ]);
        }
    }

    async resendConfirmation(email: string) {
        try {
            const { error } = await this.supabaseAdmin.auth.resend({
                type: "signup",
                email
            });
            if (error) {
                throw new BadRequestAppException(
                    "Unable to resend confirmation. The email may already be confirmed or is invalid."
                );
            }
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.resendConfirmation", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to resend confirmation email. Please try again later."
                        )
                )
            ]);
        }
    }

    async verifyOtp(email: string, token: string, type: "email" | "signup") {
        try {
            const { data, error } = await this.supabaseAdmin.auth.verifyOtp({
                email,
                token,
                type
            });
            if (error) {
                throw new BadRequestAppException(
                    "Invalid or expired verification code. Please request a new one."
                );
            }
            // If email verification, the user is now confirmed but no session is returned.
            // If type is 'signup', a session is usually returned.
            return {
                user: data.user ?? null,
                session: data.session ?? null
            };
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.verifyOtp", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to verify OTP. Please try again later."
                        )
                )
            ]);
        }
    }

    async getGoogleAuthUrl(
        req: FastifyRequest,
        reply: FastifyReply
    ): Promise<string> {
        const ssrClient = this.buildSsrClient(req, reply);
        const { data, error } = await ssrClient.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${this.backendUrl}/api/auth/google/callback`,
                queryParams: {
                    access_type: "offline",
                    prompt: "consent"
                }
            }
        });
        if (error || !data?.url) {
            throw new InternalErrorException("Could not initiate Google login");
        }
        return data.url;
    }

    async exchangeCodeForSession(
        code: string,
        req: FastifyRequest,
        reply: FastifyReply
    ): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }> {
        const ssrClient = this.buildSsrClient(req, reply);
        const { data, error: err } =
            await ssrClient.auth.exchangeCodeForSession(code);
        if (err || !data.session) {
            this.logger.error({ msg: "Token exchange failed", err });
            throw new InternalErrorException(
                "Authorization code exchange failed"
            );
        }
        return {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresIn: data.session.expires_in
        };
    }
    async verifyResetToken(email: string, token: string) {
        try {
            const { data, error } = await this.supabaseAdmin.auth.verifyOtp({
                email,
                token,
                type: "recovery"
            });
            if (error || !data.user) {
                throw new UnauthorizedAppException(
                    "Invalid or expired reset token"
                );
            }
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.verifyResetToken", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to verify the reset token. Please try again."
                        )
                )
            ]);
        }
    }

    async resetPassword(email: string, token: string, newPassword: string) {
        try {
            // Verify token (gives us the user id)
            const { data: verifyData, error: verifyError } =
                await this.supabaseAdmin.auth.verifyOtp({
                    email,
                    token,
                    type: "recovery"
                });
            if (verifyError || !verifyData.user) {
                throw new UnauthorizedAppException(
                    "Invalid or expired reset token"
                );
            }

            const { error: updateError } =
                await this.supabaseAdmin.auth.admin.updateUserById(
                    verifyData.user.id,
                    {
                        password: newPassword
                    }
                );
            if (updateError) {
                throw new BadRequestAppException(
                    "Unable to update password. The reset token may have expired or the password does not meet requirements."
                );
            }
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.resetPassword", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to reset your password. Please try again."
                        )
                )
            ]);
        }
    }

    async forgotPassword(email: string) {
        try {
            const { error } =
                await this.supabaseAdmin.auth.resetPasswordForEmail(email, {
                    redirectTo: `${this.config.get<string>(
                        "CLIENT_URL"
                    )}/reset-password`
                });
            if (error) {
                throw new BadRequestAppException(
                    "Unable to send password reset email. Please check the email address and try again."
                );
            }
        } catch (err) {
            this.errorHandler.handle(err, "AuthService.forgotPassword", [
                rule(
                    Error,
                    () =>
                        new InternalErrorException(
                            "Unable to send password reset email. Please try again later."
                        )
                )
            ]);
        }
    }

    /**
     * Mark a session as revoked in the cache.
     * When implemented, inject RedisCacheService and store the session ID
     * with a TTL equal to the remaining token lifetime (or a safe max).
     */
    async revokeSession(sessionId: string) {
        try {
            await this.cache.set(`revoked-session:${sessionId}`, "1", 900);
        } catch (err) {
            this.logger.error({
                msg: `Failed to revoke session ${sessionId}`,
                err: (err as Error).message,
                stack: (err as Error).stack
            });
        }
    }

    private buildSsrClient(req: FastifyRequest, reply: FastifyReply) {
        return createServerClient(this.supabaseUrl, this.supabasePublishable, {
            cookies: {
                getAll() {
                    return Object.entries(req.cookies).map(([name, value]) => ({
                        name,
                        value: value ?? ""
                    }));
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        reply.setCookie(name, value, {
                            ...options,
                            httpOnly: true,
                            secure: process.env.NODE_ENV === "production",
                            sameSite: "lax"
                        });
                    });
                }
            }
        });
    }
}
