import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserRole } from "#/common/entities/user-role.entity";
import { UsageModule } from "#/modules/usage/usage.module";
import { UsersModule } from "#/modules/users/users.module";
import { TeamService } from "./team.service";
import { TeamController } from "./team.controller";
import { TeamExternalController } from "./team-external.controller";
import { MailModule } from "#/modules/mail/mail.module";
import { SupabaseModule } from "#/common/supabase/supabase.module";
import { TripStop } from "#/common/entities/trip-stop.entity";
// import { NotificationSetting } from "#/common/entities/notification-setting.entity";
import { Company } from "#/common/entities/company.entity";
import { ApiKey } from "#/common/entities/api-key.entity";
import { PresenceModule } from "#/modules/presence/presence.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserRole, TripStop, Company, ApiKey]),
        UsageModule,
        UsersModule,
        MailModule,
        SupabaseModule,
        PresenceModule
    ],
    controllers: [TeamController, TeamExternalController],
    providers: [TeamService],
    exports: [TeamService]
})
export class TeamModule {}
