import {Inject, Injectable, Logger} from '@nestjs/common';
import {createClient, SupabaseClient} from '@supabase/supabase-js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  InternalErrorException,
  RateLimitedException,
  ResourceConflictException,
  UnauthorizedAppException,
} from '#/common/exceptions';
import {SUPABASE_CLIENT} from '#/common/constants/supabase.constant';
import {ErrorHandlerService, rule,} from '#/common/errors/error-handler.service';
import {RedisCacheService} from '#/common/cache/redis-cache.service';
import {ConfigService} from '@nestjs/config';
import {FastifyReply, FastifyRequest} from 'fastify';
import {createServerClient} from '@supabase/ssr';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly backendUrl;
  private readonly supabasePublishable;
  private readonly supabaseUrl;
  private readonly supabaseAnon: SupabaseClient; // anon key (for OAuth)
  private readonly turnstileSecret: string;
  private readonly SESSION_REVOKE_TTL: number;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabaseAdmin: SupabaseClient,
    private readonly errorHandler: ErrorHandlerService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {
    this.backendUrl = this.config.get<string>('BACKEND_URL')!;
    this.supabaseUrl = this.config.get<string>('SUPABASE_URL')!;
    this.supabasePublishable = this.config.get<string>(
      'SUPABASE_PUBLISHABLE_KEY',
    )!;

    this.supabaseAnon = createClient(
      this.supabaseUrl,
      this.config.get<string>('SUPABASE_ANON_KEY')!,
    );
    this.SESSION_REVOKE_TTL = this.config.get<number>(
      'SESSION_REVOKE_TTL',
      900,
    );

    this.turnstileSecret = this.config.getOrThrow('TURNSTILE_SECRET_KEY');
  }

  async login(email: string, password: string, captchaToken: string) {
    // Verify Turnstile first (fail fast)
    const isHuman = await this.verifyTurnstile(captchaToken);
    if (!isHuman) {
      throw new ForbiddenAppException(
        'Security verification failed. Please try again.',
      );
    }

    try {
      const { data, error } = await this.supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Map Supabase ban error explicitly
        if (
          error.message.includes('User is banned') ||
          error.message.includes('This user is banned') ||
          error.code === 'user_banned'
        ) {
          throw new ForbiddenAppException(
            'Your account has been suspended. Please contact your administrator.',
          );
        }

        // Generic auth failure — do not leak whether email exists
        throw new UnauthorizedAppException('Invalid email or password.');
      }

      if (!data.session) {
        throw new UnauthorizedAppException('Invalid email or password.');
      }

      return { session: data.session };
    } catch (err) {
      // Re-throw known app exceptions so they are not wrapped into InternalError
      if (
        err instanceof ForbiddenAppException ||
        err instanceof UnauthorizedAppException
      ) {
        throw err;
      }

      this.errorHandler.handle(err, 'AuthService.login', [
        rule(
          Error,
          () =>
            new InternalErrorException('Unable to log in. Please try again.'),
        ),
      ]);
    }
  }
  async signup(
    email: string,
    password: string,
    fullName: string,
    captchaToken: string,
  ) {
    //  Verify Turnstile token
    const isHuman = await this.verifyTurnstile(captchaToken);
    if (!isHuman) {
      throw new ForbiddenAppException(
        'Security verification failed. Please try again.',
      );
    }

    try {
      const { data, error } = await this.supabaseAdmin.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      // ── Explicit errors (email confirmations OFF, or validation failures) ──
      if (error) {
        const status = (error as any).status;
        const msg = error.message?.toLowerCase() ?? '';

        // 422 = conflict / already registered
        if (
          status === 422 ||
          msg.includes('already registered') ||
          msg.includes('already exists') ||
          msg.includes('duplicate')
        ) {
          throw new ResourceConflictException(
            'An account with this email already exists. Please log in or use a different email.',
          );
        }

        // 400 = validation (bad email, weak password, etc.)
        if (
          status === 400 ||
          msg.includes('valid email') ||
          msg.includes('invalid format')
        ) {
          throw new BadRequestAppException(
            'Please enter a valid email address.',
          );
        }

        if (status === 400 || msg.includes('password')) {
          throw new BadRequestAppException(
            'Password does not meet the required format. It must be at least 8 characters.',
          );
        }

        this.logger.error({
          msg: 'Signup error from Supabase',
          err: error.message,
          status,
        });
        throw new InternalErrorException(
          'Unable to create account at this moment. Please try again later.',
        );
      }

      // ── Obfuscated user (email confirmations ON + email already exists) ──
      // Supabase returns a fake user with NO identities to prevent enumeration.
      // identities === []  →  email is taken.
      if (
        data.user &&
        (!data.user.identities || data.user.identities.length === 0)
      ) {
        throw new ResourceConflictException(
          'An account with this email already exists. Please log in or use a different email.',
        );
      }

      return {
        session: data.session ?? null,
        message: data.session
          ? undefined
          : 'Please check your email to confirm your account.',
      };
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.signup', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to create account. Please try again.',
            ),
        ),
      ]);
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    try {
      // Fetch user email first (needed for sign-in verification)
      const { data: userData, error: userError } =
        await this.supabaseAdmin.auth.admin.getUserById(userId);
      if (userError || !userData?.user?.email) {
        throw new BadRequestAppException(
          'Unable to change password. Please try again later.',
        );
      }

      // Verify current password by attempting sign-in
      const { error: signInError } =
        await this.supabaseAdmin.auth.signInWithPassword({
          email: userData.user.email,
          password: currentPassword,
        });
      if (signInError) {
        throw new UnauthorizedAppException('Current password is incorrect');
      }

      // Update to new password – map any Supabase error to a safe message
      const { error: updateError } =
        await this.supabaseAdmin.auth.admin.updateUserById(userId, {
          password: newPassword,
        });
      if (updateError) {
        // Never expose the raw Supabase error to the client
        throw new BadRequestAppException(
          'Unable to change password. Please ensure your new password meets the requirements.',
        );
      }
    } catch (err) {
      // Any unexpected error (network, etc.) will be caught here and mapped to a generic 500
      this.errorHandler.handle(err, 'AuthService.changePassword', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to change password. Please try again.',
            ),
        ),
      ]);
    }
  }

  async resendConfirmation(email: string) {
    try {
      const { error } = await this.supabaseAdmin.auth.resend({
        type: 'signup',
        email,
      });
      if (error) {
        throw new BadRequestAppException(
          'Unable to resend confirmation. The email may already be confirmed or is invalid.',
        );
      }
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.resendConfirmation', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to resend confirmation email. Please try again later.',
            ),
        ),
      ]);
    }
  }

  async verifyOtp(email: string, token: string, type: 'email' | 'signup') {
    // Input validation
    if (!email?.trim() || !token?.trim()) {
      throw new BadRequestAppException(
        'Email and verification code are required.',
      );
    }

    try {
      const { data, error } = await this.supabaseAdmin.auth.verifyOtp({
        email,
        token,
        type,
      });

      if (error) {
        const msg = error.message?.toLowerCase() ?? '';
        const code = (error as any).code ?? '';

        // Map Supabase errors to semantic HTTP statuses

        // Expired OTP / session
        if (
          code === 'otp_expired' ||
          code === 'session_expired' ||
          msg.includes('expired') ||
          msg.includes('token has expired')
        ) {
          throw new UnauthorizedAppException(
            'This verification code has expired. Please request a new one.',
          );
        }

        // User banned / suspended
        if (
          code === 'user_banned' ||
          msg.includes('user is banned') ||
          msg.includes('this user is banned')
        ) {
          throw new ForbiddenAppException(
            'Your account has been suspended. Please contact your administrator.',
          );
        }

        // Rate limited by Supabase
        if (
          code === 'over_request_rate_limit' ||
          code === 'over_email_send_rate_limit' ||
          msg.includes('rate limit') ||
          msg.includes('too many requests')
        ) {
          throw new RateLimitedException(
            'Too many attempts. Please wait before trying again.',
          );
        }

        // Invalid format / malformed OTP
        if (
          code === 'validation_failed' ||
          msg.includes('invalid format') ||
          msg.includes('must be')
        ) {
          throw new BadRequestAppException('Invalid verification code format.');
        }

        // Generic invalid OTP (wrong code, already used, etc.)
        throw new BadRequestAppException(
          'Invalid verification code. Please check and try again.',
        );
      }

      return {
        user: data.user ?? null,
        session: data.session ?? null,
      };
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.verifyOtp', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to verify code. Please try again later.',
            ),
        ),
      ]);
    }
  }
  async getGoogleAuthUrl(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string> {
    const ssrClient = this.buildSsrClient(req, reply);
    const { data, error } = await ssrClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${this.backendUrl}/api/auth/google/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error || !data?.url) {
      throw new InternalErrorException('Could not initiate Google login');
    }
    return data.url;
  }

  async exchangeCodeForSession(
    code: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    const ssrClient = this.buildSsrClient(req, reply);
    const { data, error: err } =
      await ssrClient.auth.exchangeCodeForSession(code);
    if (err || !data.session) {
      this.logger.error({ msg: 'Token exchange failed', err });
      throw new InternalErrorException('Authorization code exchange failed');
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
    };
  }
  async verifyResetToken(email: string, token: string) {
    try {
      const { data, error } = await this.supabaseAdmin.auth.verifyOtp({
        email,
        token,
        type: 'recovery',
      });
      if (error || !data.user) {
        throw new UnauthorizedAppException('Invalid or expired reset token');
      }
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.verifyResetToken', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to verify the reset token. Please try again.',
            ),
        ),
      ]);
    }
  }

  async resetPassword(email: string, token: string, newPassword: string) {
    // Server-side validation (defense in depth)
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestAppException(
        'Password must be at least 8 characters long.',
      );
    }

    try {
      //  Verify the recovery OTP
      const { data: verifyData, error: verifyError } =
        await this.supabaseAdmin.auth.verifyOtp({
          email,
          token,
          type: 'recovery',
        });

      if (verifyError || !verifyData?.user) {
        const verifyMsg = verifyError?.message?.toLowerCase() ?? '';

        // ── Rate limited by Supabase ──
        if (
          verifyMsg.includes('rate limit') ||
          verifyMsg.includes('too many requests') ||
          verifyMsg.includes('over_email_send_rate_limit')
        ) {
          throw new RateLimitedException(
            'Too many attempts. Please wait before trying again.',
          );
        }
        throw new UnauthorizedAppException(
          'Invalid or expired reset token. Please request a new password reset link.',
        );
      }

      const userId = verifyData.user.id;

      // Update password
      const { error: updateError } =
        await this.supabaseAdmin.auth.admin.updateUserById(userId, {
          password: newPassword,
        });

      if (updateError) {
        const msg = updateError.message?.toLowerCase() ?? '';

        // Supabase password policy rejection (weak, breached, etc.)
        if (
          msg.includes('password') ||
          msg.includes('weak') ||
          msg.includes('strength')
        ) {
          throw new BadRequestAppException(
            'Password does not meet security requirements. Please choose a stronger password.',
          );
        }

        this.logger.error({
          msg: 'Supabase admin.updateUserById error',
          userId,
          err: updateError.message,
        });
        throw new InternalErrorException('Unable to update password.');
      }

      // SECURITY: Invalidate all existing sessions
      // After a password reset, any active session on any device must die.
      // The user must log in again with the new password.
      try {
        await this.supabaseAdmin.auth.admin.signOut(userId);
      } catch (signOutErr) {
        this.logger.warn({
          msg: 'Failed to sign out sessions after password reset',
          userId,
          err:
            signOutErr instanceof Error
              ? signOutErr.message
              : String(signOutErr),
        });
        // Non-fatal: password was still changed. Log for ops review.
      }

      return { success: true };
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.resetPassword', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to reset your password. Please try again.',
            ),
        ),
      ]);
    }
  }
  async forgotPassword(email: string, captchaToken: string) {
    // ── 1. Turnstile verification ──
    const isHuman = await this.verifyTurnstile(captchaToken);
    if (!isHuman) {
      throw new ForbiddenAppException(
        'Security verification failed. Please try again.',
      );
    }

    try {
      const { error } = await this.supabaseAdmin.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: `${this.config.get<string>('CLIENT_URL')}/reset-password`,
        },
      );

      if (error) {
        const msg = error.message?.toLowerCase() ?? '';

        // ── Rate limited by Supabase ──
        if (
          msg.includes('rate limit') ||
          msg.includes('too many requests') ||
          msg.includes('over_email_send_rate_limit')
        ) {
          throw new RateLimitedException(
            'Too many attempts. Please wait before trying again.',
          );
        }

        // ── Invalid email format (defense in depth) ──
        if (msg.includes('valid email') || msg.includes('invalid format')) {
          throw new BadRequestAppException(
            'Please enter a valid email address.',
          );
        }

        // ── SECURITY: Swallow all other Supabase errors ──
        // resetPasswordForEmail can error when an email does not exist
        // depending on Supabase version/config. Returning success here
        // prevents account enumeration attacks.
        this.logger.warn({
          msg: 'Supabase resetPasswordForEmail error swallowed to prevent enumeration',
          err: error.message,
        });
        return { success: true };
      }

      return { success: true };
    } catch (err) {
      this.errorHandler.handle(err, 'AuthService.forgotPassword', [
        rule(
          Error,
          () =>
            new InternalErrorException(
              'Unable to send password reset email. Please try again later.',
            ),
        ),
      ]);
    }
  }
  /**
   * Mark a session as revoked in the cache.
   * When implemented, inject RedisCacheService and store the session ID
   * with a TTL equal to the remaining token lifetime (or a safe max).
   */
  async revokeSession(sessionId: string, userId: string): Promise<void> {
    if (!sessionId?.trim() || !userId?.trim()) {
      throw new BadRequestAppException('Session ID and User ID are required.');
    }

    try {
      await this.cache.set(
        `revoked-session:${sessionId}`,
        '1',
        this.SESSION_REVOKE_TTL,
      );
    } catch (err) {
      this.logger.error({
        msg: 'Failed to revoke session',
        sessionId,
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new InternalErrorException(
        'Failed to revoke session. Please try again.',
      );
    }
  }

  private buildSsrClient(req: FastifyRequest, reply: FastifyReply) {
    return createServerClient(this.supabaseUrl, this.supabasePublishable, {
      cookies: {
        getAll() {
          return Object.entries(req.cookies).map(([name, value]) => ({
            name,
            value: value ?? '',
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            reply.setCookie(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            });
          });
        },
      },
    });
  }

  private async verifyTurnstile(token: string): Promise<boolean> {
    try {
      const response = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: this.turnstileSecret,
            response: token,
          }),
        },
      );

      const outcome = await response.json();
      return outcome.success === true;
    } catch (err) {
      this.logger.error({
        msg: 'Turnstile verification failed',
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
