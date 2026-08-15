import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '#/common/entities/company.entity';
import { AdminTripsController } from './trips.controller';
import { AdminTripsService } from './trips.service';
import { AdminUser } from '#/common/entities/admin-user.entity';
import { AdminAuthGuard } from '#/common/guards/admin-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Company,AdminUser])],
  controllers: [AdminTripsController],
  providers: [AdminTripsService, AdminAuthGuard],
})
export class AdminTripsModule {}
