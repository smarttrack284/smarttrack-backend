import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminImpersonationController } from "./impersonation.controller";
import { AdminImpersonationService } from "./impersonation.service";
import { UserRole } from "#/common/entities/user-role.entity";
import { Company } from "#/common/entities/company.entity";
import { ActivityLogModule } from "#/modules/activity-log/activity-log.module";

@Module({
    imports: [TypeOrmModule.forFeature([UserRole, Company]), ActivityLogModule],
    controllers: [AdminImpersonationController],
    providers: [AdminImpersonationService]
})
export class AdminImpersonationModule {}
