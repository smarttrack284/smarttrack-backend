import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '#/common/entities/user-role.entity';
import { UsageModule } from '#/modules/usage/usage.module';
import { UsersModule } from '#/modules/users/users.module';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserRole]), UsageModule, UsersModule],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}