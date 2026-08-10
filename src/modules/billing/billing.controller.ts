import { Body, Controller, Get, Headers, Post, Query, Req, UseGuards, } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { BadRequestAppException } from '#/common/exceptions';
import { SupabaseAuthGuard } from '#/common/guards/supabase-auth.guard';
import { CurrentUser } from '#/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '#/common/types/authenticated-user.type';
import { CompaniesService } from '#/modules/companies/companies.service';
import { BillingService } from './billing.service';
import { PaystackService } from '#/modules/subscriptions/paystack.service';
import { SubscriptionsService } from '#/modules/subscriptions/subscriptions.service';
import { PaystackWebhookHandlerService } from '#/modules/subscriptions/paystack-webhook-handler.service';
import { SubscriptionPlan } from '#/common/constants/subscription-plan.constant';
import { RolesGuard } from '#/common/guards/roles.guard';
import { Roles } from '#/common/decorators/roles.decorator';
import { TeamRoleType } from '#/common/types/team-role.type';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly companiesService: CompaniesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paystackService: PaystackService,
    private readonly webhookHandler: PaystackWebhookHandlerService,
  ) {}

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Get()
  async getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.billingService.getBillingOverview(user.companyId!);
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Get('history')
  async getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '10',
  ) {
    return this.billingService.getBillingHistory(
      user.companyId!,
      Number(page),
      Number(pageSize),
    );
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Post('checkout')
  async createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { plan: Exclude<SubscriptionPlan, SubscriptionPlan.FREE> },
  ) {
    const company = await this.companiesService.getCompanyById(user.companyId!);

    const authorizationUrl = await this.paystackService.initializeTransaction({
      companyId: user.companyId!,
      email: company.email,
      plan: dto.plan,
    });

    return { authorizationUrl };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Post('manage')
  async createManageLink(@CurrentUser() user: AuthenticatedUser) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(
        user.companyId!,
      );
    if (!subscription.paymentSubscriptionId) {
      throw new BadRequestAppException(
        'No active subscription exists yet for this workspace',
      );
    }
    const manageUrl = await this.paystackService.generateManageLink(
      subscription.paymentSubscriptionId,
    );
    return { manageUrl };
  }

  @UseGuards(SupabaseAuthGuard, RolesGuard)
  @Roles(TeamRoleType.OWNER)
  @Post('cancel')
  async cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
    const subscription =
      await this.subscriptionsService.getSubscriptionByCompanyId(
        user.companyId!,
      );
    if (!subscription.paymentSubscriptionId) {
      throw new BadRequestAppException(
        'No active subscription exists yet for this workspace',
      );
    }
    await this.paystackService.disableSubscription(
      subscription.paymentSubscriptionId,
    );
    return { success: true };
  }

  @Post('webhooks/paystack')
  async handlePaystackWebhook(
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature: string,
  ) {
    if (!request.rawBody || !signature) {
      throw new BadRequestAppException('Missing signature or raw body');
    }
    await this.webhookHandler.handle(request.rawBody, signature);
    return { success: true };
  }
}