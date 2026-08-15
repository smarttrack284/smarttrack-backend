import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminCompaniesController } from './companies.controller';
import { AdminCompaniesService } from './companies.service';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';
import { Company } from '#/common/entities/company.entity';
import { Subscription } from '#/common/entities/subscription.entity';
import { Usage } from '#/common/entities/usage.entity';
import { Order } from '#/common/entities/order.entity';
import { UserRole } from '#/common/entities/user-role.entity';
import { ApiKey } from '#/common/entities/api-key.entity';
import { WebhookEndpoint } from '#/common/entities/webhook-endpoint.entity';
import { ActivityLogModule } from '#/modules/activity-log/activity-log.module';
import { WebhookDelivery } from '#/common/entities/webhook-delivery.entity';
import { AdminAuditLog } from '#/common/entities/admin-audit-log.entity';
import { UsersModule } from '#/modules/users/users.module';
import { AdminUsersModule } from '#/modules/admin/users/users.module';
import { AdminUser } from '#/common/entities/admin-user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      Subscription,
      Usage,
      Order,
      UserRole,
      ApiKey,
      WebhookEndpoint,
      WebhookDelivery,
      AdminAuditLog,
      AdminUser,
    ]),
    ActivityLogModule,
    UsersModule,
    AdminUsersModule,
  ],
  controllers: [AdminCompaniesController],
  providers: [AdminCompaniesService, AdminAuthGuard],
})
export class AdminCompaniesModule {}
