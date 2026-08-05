import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";
import { SupabaseJwtVerifierService } from "#/common/auth/supabase-jwt-verifier.service";
import type { AuthenticatedUser } from "#/common/types/authenticated-user.type";

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
    private readonly logger: Logger = new Logger(SupabaseAuthGuard.name);

    constructor(private readonly verifier: SupabaseJwtVerifierService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const token = this.extractToken(request);

        if (!token) {
            this.logger.warn(
                `Auth failed: missing or malformed Authorization header [reqId: ${this.getRequestId(
                    request
                )}]`
            );
            throw new UnauthorizedAppException("Missing bearer token");
        }

        try {
            const payload = await this.verifier.verify(token);

            request.user = payload;

            return true;
        } catch (err) {
            // Pass through our own auth exceptions without re-wrapping
            if (err instanceof UnauthorizedAppException) {
                this.logger.warn(
                    `Auth failed: ${err.message} [reqId: ${this.getRequestId(
                        request
                    )}]`
                );
                throw err;
            }

            // System-level errors (JWKS unreachable, Redis down, etc.)
            // Log full detail server-side, send generic message client-side.
            this.logger.error(
                `JWT verification system error [reqId: ${this.getRequestId(
                    request
                )}]: ${err instanceof Error ? err.message : String(err)}`,
                err instanceof Error ? err.stack : undefined
            );
            throw new InternalErrorException(
                "Authentication service unavailable"
            );
        }
    }

    /**
     * Robust extraction: handles extra whitespace and case-insensitive scheme.
     * Returns null for any malformed header so we fail closed.
     */
    private extractToken(request: FastifyRequest): string | null {
        const header = request.headers.authorization;
        if (typeof header !== "string") return null;

        const parts = header.split(" ");
        if (parts.length !== 2) return null;

        const [scheme, token] = parts;
        if (
            scheme?.toLowerCase() !== "bearer" ||
            !token ||
            token.length === 0
        ) {
            return null;
        }

        return token;
    }

    private getRequestId(request: FastifyRequest): string {
        return String(request.id ?? "unknown");
    }
}
