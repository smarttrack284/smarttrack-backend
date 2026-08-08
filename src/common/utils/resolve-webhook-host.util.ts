import { resolve4, resolve6 } from 'node:dns/promises';
import { isBlockedIpAddress } from './webhook-url-validator.util';

export class WebhookHostBlockedError extends Error {
  constructor(message: string, public readonly reason: 'blocked' | 'unresolvable') {
    super(message);
    this.name = 'WebhookHostBlockedError';
  }
}

/**
 * Resolves the hostname to ALL IPv4 and IPv6 addresses via DNS,
 * then checks each one against the private‑range blocklist.
 *
 * Returns a single IP that will be used to pin the request.
 *
 * Throws `WebhookHostBlockedError` if any resolved address is private or
 * if the hostname could not be resolved at all.
 */
export async function resolveAndValidateWebhookHost(hostname: string): Promise<string> {
  // Resolve both IPv4 and IPv6 in parallel (no TTL needed)
  const [ipv4, ipv6] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);

  const allAddresses: string[] = [];

  if (ipv4.status === 'fulfilled') {
    allAddresses.push(...ipv4.value);
  }
  if (ipv6.status === 'fulfilled') {
    allAddresses.push(...ipv6.value);
  }

  if (allAddresses.length === 0) {
    throw new WebhookHostBlockedError(
      `Could not resolve hostname "${hostname}"`,
      'unresolvable',
    );
  }

  // If ANY resolved address is private, block the entire host
  for (const addr of allAddresses) {
    if (isBlockedIpAddress(addr)) {
      throw new WebhookHostBlockedError(
        `Resolved address ${addr} for "${hostname}" is a private or reserved IP`,
        'blocked',
      );
    }
  }

  // Return the first public IPv4 (preferred) or IPv6
  return allAddresses[0];
}