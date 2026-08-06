import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ROLES_KEY } from "#/common/decorators/roles.decorator";
import {
    InsufficientPermissionsException,
    InternalErrorException,
    UnauthorizedAppException
} from "#/common/exceptions";

@Injectable()
export class RolesGuard implements CanActivate {
    private readonly logger = new Logger(RolesGuard.name);

    constructor(private readonly reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()]
        );

        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<FastifyRequest>();

        // The SupabaseAuthGuard already validated the JWT and attached
        // user with id, companyId, and role.
        const userId: string | undefined = request.user?.id;
        const userRole: string | undefined = request.user?.role;

        if (!userId || !userRole) {
            this.logger.warn(
                `RolesGuard: request.user missing id or role – was SupabaseAuthGuard applied?`
            );
            throw new UnauthorizedAppException(
                "Authentication required to access this resource"
            );
        }

        const normalizedRequired = requiredRoles.map(r =>
            r.toLowerCase().trim()
        );
        const actualRole = userRole.toLowerCase().trim();

        if (!normalizedRequired.includes(actualRole)) {
            this.logger.warn(
                `RolesGuard: Access denied for user ${userId}. ` +
                    `Required: [${normalizedRequired.join(
                        ", "
                    )}], Actual: ${actualRole}`
            );
            throw new InsufficientPermissionsException(
                "You do not have permission to access this resource"
            );
        }



        return true;
    }
}
