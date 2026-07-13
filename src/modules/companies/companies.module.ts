import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '#/common/entities/company.entity';
import { NotificationSetting } from '#/common/entities/notification-setting.entity';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { UsersModule } from '#/modules/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Company, NotificationSetting]),
    UsersModule,
  ],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
