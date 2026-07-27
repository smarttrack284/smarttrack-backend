import { lookup } from 'node:dns/promises';
import { isBlockedIpAddress } from './webhook-url-validator.util';

export class WebhookHostBlockedError extends Error {}

/**
 * Resolves the webhook URL's hostname to a real IP RIGHT NOW, checks that
 * specific resolved IP against the private-range blocklist, and returns
 * it. This is what closes the DNS-rebinding gap: creation-time validation
 * only ever sees whatever the hostname resolved to AT THAT MOMENT — an
 * attacker can point the domain at a public IP during validation, then
 * repoint it at 127.0.0.1 by the time delivery actually fires. Resolving
 * fresh, at the moment of delivery, and pinning the request to exactly
 * that IP (see webhook-delivery.processor.ts's dispatcher) means there's
 * no window between "check" and "use" for the DNS record to change.
 */
export async function resolveAndValidateWebhookHost(
  hostname: string,
): Promise<string> {
  let resolved: { address: string };
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new WebhookHostBlockedError(
      `Could not resolve hostname "${hostname}"`,
    );
  }

  if (isBlockedIpAddress(resolved.address)) {
    throw new WebhookHostBlockedError(
      `Resolved address for "${hostname}" is a private or reserved IP`,
    );
  }

  return resolved.address;
}
