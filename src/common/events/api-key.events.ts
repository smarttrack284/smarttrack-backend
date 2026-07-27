export const API_KEY_EVENTS = {
    CREATED: "api_key.created",
    REVOKED: "api_key.revoked"
} as const;

export class ApiKeyCreatedEvent {
    constructor(
        public readonly companyId: string,
        public readonly keyName: string
    ) {}
}
export class ApiKeyRevokedEvent {
    constructor(
        public readonly companyId: string,
        public readonly keyName: string
    ) {}
}
