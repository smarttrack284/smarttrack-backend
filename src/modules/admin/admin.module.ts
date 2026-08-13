import { Module } from "@nestjs/common";
import { AdminCompaniesModule } from "./companies/companies.module";
import { AdminUsersModule } from "./users/users.module";
import { AdminActivityLogModule } from "./activity-log/activity-log.module";
import { AdminImpersonationModule } from "./impersonation/impersonation.module";

@Module({
    imports: [AdminCompaniesModule, AdminUsersModule, AdminActivityLogModule,
    AdminImpersonationModule]
})
export class AdminModule {}
