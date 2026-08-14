import {
    Body,
    Controller,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
    Res,
    UseGuards
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";
import { SuperAdminGuard } from "#/common/guards/super-admin.guard";
import { AdminImpersonationService } from "./impersonation.service";
import { ImpersonateCompanyDto } from "./dto/impersonate-company.dto";
import { ConfigService } from "@nestjs/config";
import { PublicThrottle } from "#/common/decorators/throttle.decorator";
import { AdminAuditLogService } from "../audit-log/audit-log.service";
import { ActivitySeverity } from "#/common/constants/activity-log.constant";

@UseGuards(AdminAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller("admin/companies/:id/impersonate")
export class AdminImpersonationController {
    constructor(
        private readonly adminImpersonationService: AdminImpersonationService,
        private readonly config: ConfigService,
        private readonly adminAuditLogService: AdminAuditLogService
    ) {}

    @Post()
    async impersonate(
        @Param("id", ParseUUIDPipe) companyId: string,
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply,
        @Body() dto: ImpersonateCompanyDto
    ) {
        const adminUserId = (request as any).adminUser.userId;
        const { accessToken, expiresIn } =
            await this.adminImpersonationService.impersonateCompany(
                companyId,
                adminUserId,
                dto
            );

        const isProd = this.config.get<string>("NODE_ENV") === "production";
        reply.setCookie("sb-impersonation-token", accessToken, {
            httpOnly: true,
            secure: isProd,
            sameSite: "strict",
            path: "/",
            maxAge: expiresIn
        });

        reply.send({ success: true, expiresIn });
    }

    @Post("end")
    async endImpersonation(
        @Req() request: FastifyRequest,
        @Res() reply: FastifyReply
    ) {
        // Clear the impersonation cookie – subsequent requests will use the
        // admin's normal access token cookie.
        reply.clearCookie("sb-impersonation-token", { path: "/" });

        const adminUser = (request as any).adminUser;
        if (adminUser) {
            await this.adminAuditLogService.record({
                adminUserId: adminUser.userId,
                action: "admin.impersonation_ended",
                severity: ActivitySeverity.INFO,
                message: `Admin ${adminUser.email} ended impersonation`,
                metadata: { adminUserId: adminUser.userId }
            });
        }

        return { success: true, message: "Impersonation ended" };
    }
}
