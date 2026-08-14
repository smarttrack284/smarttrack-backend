import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminUser } from "#/common/entities/admin-user.entity";
import { AdminInvite } from "#/common/entities/admin-invite.entity";
import { AdminAdminsController } from "./admins.controller";
import { AdminAdminsService } from "./admins.service";
import { AdminAuditLogModule } from "../audit-log/audit-log.module";
import { UsersModule } from "#/modules/users/users.module";
import { MailModule } from "#/modules/mail/mail.module";
import { AdminAuthGuard } from "#/common/guards/admin-auth.guard";

@Module({
    imports: [
        TypeOrmModule.forFeature([AdminUser, AdminInvite]),
        AdminAuditLogModule,
        UsersModule
    ],
    controllers: [AdminAdminsController],
    providers: [AdminAdminsService, AdminAuthGuard]
})
export class AdminAdminsModule {}
