import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { Company } from '#/common/entities/company.entity';
import { SupabaseModule } from '#/common/supabase/supabase.module';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, Company, NotificationSetting]),
    SupabaseModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
