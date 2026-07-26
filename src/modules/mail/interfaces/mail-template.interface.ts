export enum MailTemplate {
    /**
     * Team
     */
    TEAM_INVITE = "team-invite",
    TEAM_MEMBER_ACCEPTED = "team-memember-accepted",

    /**
     * Customer order notifications
     */
    ORDER_CREATED = "order-created",
    ORDER_ASSIGNED = "order-assigned",
    ORDER_PICKED_UP = "order-picked-up",
    ORDER_IN_TRANSIT = "order-in-transit",
    ORDER_DELIVERED = "order-delivered",
    ORDER_FAILED = "order-failed",
    ORDER_CANCELLED = "order-cancelled",

    /**
     * Team order notifications
     */
    TEAM_ORDER_CREATED = "team-order-created",
    TEAM_ORDER_ASSIGNED = "team-order-assigned",
    TEAM_ORDER_PICKED_UP = "team-order-picked-up",
    TEAM_ORDER_IN_TRANSIT = "team-order-in-transit",
    TEAM_ORDER_DELIVERED = "team-order-delivered",
    TEAM_ORDER_FAILED = "team-order-failed",
    TEAM_ORDER_CANCELLED = "team-order-cancelled"
}

/**
 * Team invitation email.
 */
export type TeamInviteContext = {
    companyName: string;
    inviterName: string;
    roleLabel: string;
    acceptUrl: string;
};

/**
 * Customer order email.
 * Shared across all customer order lifecycle templates.
 */
export type CustomerOrderContext = {
    companyName: string;
    customerName: string;
    orderReference: string;
    statusLabel: string;
    trackingUrl: string;
    supportEmail: string;
};

/**
 * Team member order email.
 * Shared across all internal order lifecycle templates.
 */
export type TeamOrderContext = {
  companyName: string;
  customerName: string;
  memberName: string;
  orderReference: string;
  statusLabel: string;
  previousStatus?: string;
  updatedBy: string;
  orderUrl: string;
};

export type TeamMemberAcceptedContext = {
  companyName: string;
  memberName: string;
  memberEmail: string;
  roleLabel: string;
  joinedAt: string;
  teamUrl: string;
  year: number;
};

/**
 * Maps every email template to its strongly typed context.
 *
 * This enables:
 *
 * mailService.sendTemplateEmail({
 *     templateName: MailTemplate.ORDER_DELIVERED,
 *     context: ...
 * })
 *
 * to be fully type-safe.
 */
export type MailTemplateContextMap = {
    /**
     * Team
     */
    [MailTemplate.TEAM_INVITE]: TeamInviteContext;
    [MailTemplate.TEAM_MEMBER_ACCEPTED]: TeamMemberAcceptedContext;

    /**
     * Customer
     */
    [MailTemplate.ORDER_CREATED]: CustomerOrderContext;
    [MailTemplate.ORDER_ASSIGNED]: CustomerOrderContext;
    [MailTemplate.ORDER_PICKED_UP]: CustomerOrderContext;
    [MailTemplate.ORDER_IN_TRANSIT]: CustomerOrderContext;
    [MailTemplate.ORDER_DELIVERED]: CustomerOrderContext;
    [MailTemplate.ORDER_FAILED]: CustomerOrderContext;
    [MailTemplate.ORDER_CANCELLED]: CustomerOrderContext;

    /**
     * Team
     */
    [MailTemplate.TEAM_ORDER_CREATED]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_ASSIGNED]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_PICKED_UP]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_IN_TRANSIT]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_DELIVERED]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_FAILED]: TeamOrderContext;
    [MailTemplate.TEAM_ORDER_CANCELLED]: TeamOrderContext;
};
