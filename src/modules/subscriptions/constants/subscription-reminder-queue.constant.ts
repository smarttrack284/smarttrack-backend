export const SUBSCRIPTION_REMINDER_QUEUE_NAME = "subscription-reminders";

export enum SubscriptionReminderJobName {
    SEND_EXPIRY_REMINDER = "send-expiry-reminder"
}
export type sendExpirationRemindersJobData = {
    subscriptionId: string;
    companyId: string;
    
};
