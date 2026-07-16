export enum MailTemplate {
  TEAM_INVITE = 'team-invite',
  ORDER_STATUS_UPDATE = 'order-status-update',
}

export type TeamInviteContext = {
  companyName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
};

export type OrderStatusUpdateContext = {
  customerName: string;
  orderReference: string;
  statusLabel: string;
  trackingUrl: string;
};

/**
 * Maps each MailTemplate to its exact context shape. This is what makes
 * MailService.sendTemplateEmail<T> type-safe — passing TEAM_INVITE forces
 * the context argument to match TeamInviteContext, not a loose
 * Record<string, unknown>. Adding a new template later means adding one
 * enum member, one context type here, and one .hbs file — nothing else in
 * the module needs to change.
 */
export type MailTemplateContextMap = {
  [MailTemplate.TEAM_INVITE]: TeamInviteContext;
  [MailTemplate.ORDER_STATUS_UPDATE]: OrderStatusUpdateContext;
};
