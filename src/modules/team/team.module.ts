import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { UsageModule } from '#/modules/usage/usage.module';
import { UsersModule } from '#/modules/users/users.module';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { MailModule } from '#/modules/mail/mail.module';
import { SupabaseModule } from '#/common/supabase/supabase.module';
import { TripStop } from '#/common/entities/trip-stop.entity';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { Company } from '#/common/entities/company.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, TripStop, NotificationSetting,Company]),
    UsageModule,
    UsersModule,
    MailModule,
    SupabaseModule,

  ],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
