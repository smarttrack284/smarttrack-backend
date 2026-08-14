import { Module } from '@nestjs/common';
import { AdminCompaniesModule } from './companies/companies.module';
import { AdminUsersModule } from './users/users.module';
import { AdminActivityLogModule } from './activity-log/activity-log.module';
import { AdminImpersonationModule } from './impersonation/impersonation.module';
import { AdminDashboardModule } from '#/modules/admin/dashboard/dashboard.module';

@Module({
  imports: [
    AdminCompaniesModule,
    AdminUsersModule,
    AdminActivityLogModule,
    AdminImpersonationModule,
    AdminDashboardModule,
  ],
})
export class AdminModule {}
