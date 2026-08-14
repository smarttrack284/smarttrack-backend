import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenAppException } from '#/common/exceptions';
import { AdminRole } from '#/common/constants/admin-role.constant';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const adminUser = (request as any).adminUser;

    if (!adminUser || adminUser.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenAppException('Super admin access required');
    }
    return true;
  }
}