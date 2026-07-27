import { BadRequestAppException } from '#/common/exceptions';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAME_PATTERNS = [/^localhost$/i];

/**
 * IP-range check, usable against BOTH the raw hostname (rare, if someone
 * enters a literal IP as the URL) and a RESOLVED address (the actual
 * defense against DNS rebinding — see resolveAndValidateWebhookHost).
 */
export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false; // not an IP literal at all

  if (version === 4) {
    return (
      /^127\./.test(address) ||
      /^10\./.test(address) ||
      /^192\.168\./.test(address) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
      /^169\.254\./.test(address) ||
      address === '0.0.0.0'
    );
  }

  // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10)
  return (
    address === '::1' ||
    /^f[cd][0-9a-f]{2}:/i.test(address) ||
    /^fe80:/i.test(address)
  );
}

/** Creation-time check — catches obviously bad hostnames/literal private IPs immediately, before anything is saved. Does NOT protect against rebinding on its own — see resolveAndValidateWebhookHost for the delivery-time check that actually does. */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestAppException('Enter a valid webhook URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestAppException('Webhook URLs must use HTTPS');
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(parsed.hostname))) {
    throw new BadRequestAppException(
      'This URL points to a private or reserved address and cannot be used',
    );
  }
  if (isBlockedIpAddress(parsed.hostname)) {
    throw new BadRequestAppException(
      'This URL points to a private or reserved address and cannot be used',
    );
  }
}
