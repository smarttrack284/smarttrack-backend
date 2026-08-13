import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(options: any, storageService: any, reflector: Reflector) {
    super(options, storageService, reflector);
  }

  protected async getTracker(request: Record<string, any>): Promise<string> {
    if (request.user?.id) return `user:${request.user.id}`;
    if (request.headers['x-api-key']) return `apikey:${request.headers['x-api-key']}`;
    return `ip:${request.ip}`;
  }
}
