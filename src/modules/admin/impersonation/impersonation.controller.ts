import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards, } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { SuperAdminGuard } from '#/common/guards/super-admin.guard';
import { AdminImpersonationService } from './impersonation.service';
import { ImpersonateCompanyDto } from './dto/impersonate-company.dto';
import { ConfigService } from '@nestjs/config';
import { PublicThrottle } from '#/common/decorators/throttle.decorator';

@UseGuards(SupabaseAuthGuard, SuperAdminGuard)
@PublicThrottle()
@Controller('admin/companies/:id/impersonate')
export class AdminImpersonationController {
  constructor(
    private readonly adminImpersonationService: AdminImpersonationService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async impersonate(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Body() dto: ImpersonateCompanyDto,
  ) {
    const adminUserId = (request as any).user.id;
    const { accessToken, expiresIn } =
      await this.adminImpersonationService.impersonateCompany(
        companyId,
        adminUserId,
        dto,
      );

    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    reply.setCookie('sb-impersonation-token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
      maxAge: expiresIn,
    });

    reply.send({ success: true, expiresIn });
  }
}
