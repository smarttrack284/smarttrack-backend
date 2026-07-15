export enum StopStatus {
  PENDING = 'pending',
  ARRIVED = 'arrived',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

export enum SkipReasonCode {
  CUSTOMER_UNAVAILABLE = 'customer_unavailable',
  WRONG_ADDRESS = 'wrong_address',
  CUSTOMER_REFUSED = 'customer_refused',
  ACCESS_ISSUE = 'access_issue',
  OTHER = 'other',
}