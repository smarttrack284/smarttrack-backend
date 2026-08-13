import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ForbiddenAppException } from "#/common/exceptions";
import { TeamRoleType } from "#/common/types/team-role.type";

@Injectable()
export class SuperAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const user = (request as any).user;

        if (!user || user.role !== TeamRoleType.SUPER_ADMIN) {
            throw new ForbiddenAppException(
                "You do not have permission to access this resource."
            );
        }

        return true;
    }
}
