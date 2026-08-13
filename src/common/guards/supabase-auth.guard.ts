import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import {
    ForbiddenAppException,
    UnauthorizedAppException,
} from "#/common/exceptions";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import { RedisCacheService } from "#/common/cache/redis-cache.service";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { TeamMemberStatus } from "#/common/constants/team-member-status.constant";
import * as Sentry from "@sentry/node";

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
    private readonly logger = new Logger(SupabaseAuthGuard.name);
    private readonly supabaseUrl: string;
    private readonly supabasePublishableKey: string;
    private readonly impersonationSecret: string;
    private readonly USER_COMPANY_CACHE_TTL: number;

    constructor(
        private readonly verifier: SupabaseJwtVerifierService,
        private readonly cache: RedisCacheService,
        private readonly config: ConfigService,
        @InjectRepository(UserRole)
        private readonly userRoleRepo: Repository<UserRole>,
    ) {
        this.supabaseUrl = this.config.get<string>("SUPABASE_URL")!;
        this.supabasePublishableKey = this.config.get<string>(
            "SUPABASE_PUBLISHABLE_KEY",
        )!;
        this.USER_COMPANY_CACHE_TTL = this.config.get<number>(
            "USER_COMPANY_CACHE_TTL",
            300,
        );
        this.impersonationSecret = this.config.get<string>(
            "IMPERSONATION_SECRET",
        )!;
        if (!this.impersonationSecret) {
            throw new Error("IMPERSONATION_SECRET environment variable is required");
        }
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const reply = context.switchToHttp().getResponse<FastifyReply>();

        // 1. Impersonation token takes precedence if present
        const impersonationToken = request.cookies?.["sb-impersonation-token"];
        if (impersonationToken) {
            try {
                const payload = await this.verifyImpersonationToken(impersonationToken);
                (request as any).user = {
                    id: payload.sub as string,
                    email: payload.email as string,
                    companyId: payload.companyId as string,
                    role: payload.role as string,
                    impersonated: true,
                    impersonatedBy: payload.impersonatedBy as string,
                };
                Sentry.setUser({
                    id: payload.sub as string,
                    email: payload.email as string,
                    companyId: payload.companyId as string,
                    role: payload.role as string,
                });
                return true;
            } catch {
                // Invalid or expired impersonation token – clear it and fall through
                reply.clearCookie("sb-impersonation-token", { path: "/" });
            }
        }

        // 2. Normal Supabase access token flow
        let token = request.cookies?.["sb-access-token"] ?? null;

        if (!token) {
            const refreshToken = request.cookies?.["sb-refresh-token"];
            if (refreshToken) {
                try {
                    const newTokens = await this.refreshTokens(refreshToken);
                    this.setCookies(
                        reply,
                        newTokens.accessToken,
                        newTokens.refreshToken,
                        newTokens.expiresIn,
                    );
                    token = newTokens.accessToken;
                } catch {
                    this.clearCookies(request, reply);
                    throw new UnauthorizedAppException(
                        "Session expired. Please log in again.",
                    );
                }
            } else {
                throw new UnauthorizedAppException("Missing session cookie");
            }
        }

        let payload: Awaited<ReturnType<typeof this.verifier.verify>>;
        try {
            payload = await this.verifier.verify(token);
        } catch (verifyErr) {
            const refreshToken = request.cookies?.["sb-refresh-token"];
            if (refreshToken) {
                try {
                    const newTokens = await this.refreshTokens(refreshToken);
                    this.setCookies(
                        reply,
                        newTokens.accessToken,
                        newTokens.refreshToken,
                        newTokens.expiresIn,
                    );
                    payload = await this.verifier.verify(newTokens.accessToken);
                } catch {
                    this.clearCookies(request, reply);
                    throw new UnauthorizedAppException(
                        "Session expired. Please log in again.",
                    );
                }
            } else {
                throw verifyErr;
            }
        }

        // Session blacklist check
        if (payload.sessionId) {
            const blacklisted = await this.cache.get(
                `revoked-session:${payload.sessionId}`,
            );
            if (blacklisted) {
                this.logger.warn({
                    msg: `Auth failed: session ${payload.sessionId} has been revoked [reqId: ${this.getRequestId(request)}]`,
                });
                throw new UnauthorizedAppException("Session has been revoked");
            }
        }

        const userId = payload.id;
        const membership = await this.cache.getOrSet<
            Pick<
                UserRole,
                "companyId" | "role" | "status" | "name" | "avatarUrl"
            > | null
        >(
            `user:company:${userId}`,
            this.USER_COMPANY_CACHE_TTL,
            async () =>
                this.userRoleRepo.findOne({
                    where: { userId },
                    select: {
                        companyId: true,
                        role: true,
                        status: true,
                        name: true,
                        avatarUrl: true,
                    },
                }),
        );

        if (!membership) {
            this.logger.warn({
                msg: `Auth failed: no UserRole for ${userId} [reqId: ${this.getRequestId(request)}]`,
            });
            throw new ForbiddenAppException(
                "Your account is not associated with any company",
            );
        }
        if (membership.status !== TeamMemberStatus.ACTIVE) {
            this.logger.warn({
                msg: `Auth failed: inactive status ${membership.status} for ${userId} [reqId: ${this.getRequestId(request)}]`,
            });
            throw new ForbiddenAppException(
                "Your account is not active. Please contact your administrator.",
            );
        }

        (request as any).user = {
            ...payload,
            name: membership.name,
            companyId: membership.companyId,
            role: membership.role,
        };

        Sentry.setUser({
            id: payload.id,
            name: membership.name,
            email: payload.email,
            companyId: membership.companyId,
            role: membership.role,
        });

        return true;
    }

    private async verifyImpersonationToken(token: string) {
        const { payload } = await jwtVerify(
            token,
            new TextEncoder().encode(this.impersonationSecret),
            { algorithms: ["HS256"] },
        );
        return payload as Record<string, unknown>;
    }

    private async refreshTokens(refreshToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }> {
        const response = await fetch(
            `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    apikey: this.supabasePublishableKey,
                },
                body: JSON.stringify({ refresh_token: refreshToken }),
            },
        );

        if (!response.ok) {
            throw new Error("Refresh token exchange failed");
        }

        const data = await response.json();
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
        };
    }

    private setCookies(
        reply: FastifyReply,
        accessToken: string,
        refreshToken: string,
        expiresIn: number,
    ) {
        const isProd = process.env.NODE_ENV === "production";
        reply.setCookie("sb-access-token", accessToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: "strict",
            path: "/",
            maxAge: expiresIn,
        });
        reply.setCookie("sb-refresh-token", refreshToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: "strict",
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
        });
    }

    private clearCookies(request: FastifyRequest, reply: FastifyReply) {
        const cookieNames = Object.keys(request.cookies);
        for (const name of cookieNames) {
            if (name.startsWith("sb-")) {
                reply.clearCookie(name, { path: "/" });
            }
        }
    }

    private getRequestId(request: FastifyRequest): string {
        return String(request.id ?? "unknown");
    }
}