export type AuthenticatedUser = {
  id: string;
  email: string;
  metadata: Record<string, unknown>;
};
