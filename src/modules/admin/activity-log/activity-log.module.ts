import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ActivityLog } from "#/common/entities/activity-log.entity";
import { Company } from "#/common/entities/company.entity";
import { AdminActivityLogController } from "./activity-log.controller";
import { AdminActivityLogService } from "./activity-log.service";

@Module({
    imports: [TypeOrmModule.forFeature([ActivityLog, Company])],
    controllers: [AdminActivityLogController],
    providers: [AdminActivityLogService, ]
})
export class AdminActivityLogModule {}
