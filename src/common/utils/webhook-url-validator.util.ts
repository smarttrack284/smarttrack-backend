import { BadRequestAppException } from "#/common/exceptions";
import { isIP } from "node:net";

const BLOCKED_HOSTNAME_PATTERNS = [
    /^localhost$/i,
    /\.local$/i,
    /^broadcasthost$/i
];

/**
 * IP‑range blocklist – covers all RFC‑defined private, reserved, and
 * special‑use addresses that should never be reachable from a public
 * webhook sender.
 */
export function isBlockedIpAddress(address: string): boolean {
    const version = isIP(address);
    if (version === 0) return false;

    if (version === 4) {
        return (
            // Loopback – 127.0.0.0/8
            /^127\./.test(address) ||
            // Private – 10.0.0.0/8
            /^10\./.test(address) ||
            // Private – 192.168.0.0/16
            /^192\.168\./.test(address) ||
            // Private – 172.16.0.0/12
            /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
            // Link‑local – 169.254.0.0/16
            /^169\.254\./.test(address) ||
            // CGNAT – 100.64.0.0/10
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ||
            // Current network (including "0.0.0.0") – 0.0.0.0/8
            /^0\./.test(address) ||
            // Benchmarking – 198.18.0.0/15
            /^198\.(1[89]|20)\./.test(address) ||
            // Documentation – 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
            /^192\.0\.2\.\d+$/.test(address) ||
            /^198\.51\.100\.\d+$/.test(address) ||
            /^203\.0\.113\.\d+$/.test(address)
        );
    }

    // IPv6 – loopback, unique‑local (fc00::/7), link‑local (fe80::/10)
    return (
        address === "::1" ||
        /^f[cd][0-9a-f]{2}:/i.test(address) ||
        /^fe80:/i.test(address)
    );
}

/**
 * Creation‑time validation.
 *
 * This catches obviously malicious URLs before they are saved. It does NOT
 * protect against DNS rebinding — that’s done at delivery time via
 * `resolveAndValidateWebhookHost`.
 */
export function validateWebhookUrl(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new BadRequestAppException("Enter a valid webhook URL");
    }

    // Protocol must be HTTPS
    if (parsed.protocol !== "https:") {
        throw new BadRequestAppException("Webhook URLs must use HTTPS");
    }

    // Reject URLs with embedded credentials (user:pass@host)
    if (parsed.username || parsed.password) {
        throw new BadRequestAppException(
            "Webhook URLs must not contain credentials"
        );
    }

    // Reject non‑standard ports (443 only)
    if (parsed.port && parsed.port !== "443") {
        throw new BadRequestAppException(
            "Webhook URLs must use the default HTTPS port (443)"
        );
    }

    // Block known‑bad hostnames
    if (BLOCKED_HOSTNAME_PATTERNS.some(p => p.test(parsed.hostname))) {
        throw new BadRequestAppException(
            "This URL points to a private or reserved address and cannot be used"
        );
    }

    // Block literal private / reserved IP addresses
    if (isBlockedIpAddress(parsed.hostname)) {
        throw new BadRequestAppException(
            "This URL points to a private or reserved address and cannot be used"
        );
    }
}