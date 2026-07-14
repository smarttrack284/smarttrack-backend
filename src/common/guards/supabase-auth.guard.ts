import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedAppException } from "#/common/exceptions";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";

/**
 * Verifies a Supabase-issued JWT against Supabase's published public
 * signing keys (JWKS) — Supabase's current default signing approach for
 * new projects, replacing the legacy shared HS256 secret.
 *
 * This is still "local" verification in the sense that matters for cost:
 * createRemoteJWKSet caches fetched public keys in memory and only
 * re-fetches when a token references a key ID it hasn't seen before (with
 * a cooldown against repeated failed lookups) — so this does NOT make a
 * network call on every request, and never touches Postgres.
 *
 * The JWKS set is built once in the constructor (this guard is a
 * singleton provider), not per canActivate call — building it per-request
 * would defeat the caching entirely.
 *
 * ASSUMPTION: Supabase's new keys are ES256 (ECDSA P-256) — verify this
 * against your actual project (Dashboard -> Project Settings -> API ->
 * JWT Settings) rather than trusting it blindly, since getting the
 * `algorithms` allowlist wrong here fails closed (tokens get rejected),
 * not open, but it's worth confirming rather than assuming.
 *
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
    private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
    private readonly issuer: string;

    constructor(private readonly config: ConfigService) {
        const supabaseUrl = this.config.get<string>("SUPABASE_URL");
        if (!supabaseUrl) {
            throw new Error("SUPABASE_URL is not configured");
        }

        this.issuer = `${supabaseUrl}/auth/v1`;
        this.jwks = createRemoteJWKSet(
            new URL(`${this.issuer}/.well-known/jwks.json`),
            {
                cooldownDuration: 30_000, // don't re-fetch more than once per 30s even on repeated unknown-key failures
                cacheMaxAge: 10 * 60_000 // treat cached keys as fresh for 10 minutes before allowing a routine refresh
            }
        );
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const token = this.extractToken(request);

        if (!token) {
            throw new UnauthorizedAppException("Missing bearer token");
        }

        try {
            const { payload } = await jwtVerify(token, this.jwks, {
                issuer: this.issuer,
                algorithms: ["ES256"]
            });
            request.user = this.mapPayloadToUser(payload);
            return true;
        } catch {
            throw new UnauthorizedAppException("Invalid or expired token");
        }
    }

    private extractToken(request: FastifyRequest): string | null {
        const header = request.headers.authorization;
        if (!header?.startsWith("Bearer ")) return null;
        return header.slice("Bearer ".length).trim();
    }

    private mapPayloadToUser(payload: JWTPayload): AuthenticatedUser {
        if (!payload.sub) {
            throw new UnauthorizedAppException(
                "Token is missing a subject claim"
            );
        }
        return {
            id: payload.sub,
            email: typeof payload.email === "string" ? payload.email : "",
            metadata:
                typeof payload.user_metadata === "object" &&
                payload.user_metadata !== null
                    ? (payload.user_metadata as Record<string, unknown>)
                    : {}
        };
    }
}
