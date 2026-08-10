import { Module } from '@nestjs/common';
import { AuthController } from '#/modules/auth/auth.controller';
import { AuthService } from '#/modules/auth/auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '#/common/entities/user-role.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserRole])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}