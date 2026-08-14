import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { ForbiddenAppException, UnauthorizedAppException } from '#/common/exceptions';
import { SupabaseJwtVerifierService } from '#/common/auth/supabase-jwt-verifier.service';
import { RedisCacheService } from '#/common/cache/redis-cache.service';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminUser } from '#/common/entities/admin-user.entity';
import { AdminRole } from '#/common/constants/admin-role.constant';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);
  private readonly CACHE_TTL = 300;

  constructor(
    private readonly verifier: SupabaseJwtVerifierService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
    @InjectRepository(AdminUser)
    private readonly adminUserRepo: Repository<AdminUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.['sb-access-token'] ?? null;

    if (!token) {
      throw new UnauthorizedAppException('Missing session cookie');
    }

    let payload;
    try {
      payload = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedAppException('Session expired. Please log in again.');
    }

    const userId = payload.id;
    const cacheKey = `admin:user:${userId}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.isActive) {
        (request as any).adminUser = data;
        return true;
      }
      throw new ForbiddenAppException('Insufficient permissions');
    }

    const adminUser = await this.adminUserRepo.findOne({
      where: { userId, isActive: true },
    });

    if (!adminUser) {
      throw new ForbiddenAppException('Insufficient permissions');
    }

    const cachedAdmin = {
      id: adminUser.id,
      userId: adminUser.userId,
      name: adminUser.name,
      email: adminUser.email,
      role: adminUser.role,
      isActive: adminUser.isActive,
    };

    await this.cache.set(
      cacheKey,
      JSON.stringify(cachedAdmin),
      this.CACHE_TTL,
    );

    (request as any).adminUser = cachedAdmin;
    return true;
  }
}