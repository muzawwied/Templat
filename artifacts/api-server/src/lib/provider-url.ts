import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function publicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (!normalized || normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    return isIP(mapped) === 4 && publicIpv4(mapped);
  }
  // Permit global unicast only. This excludes ULA, link-local, multicast,
  // IPv4-compatible, and special-use ranges.
  return normalized.startsWith("2") || normalized.startsWith("3");
}

function publicAddress(address: string): boolean {
  return isIP(address) === 4
    ? publicIpv4(address)
    : isIP(address) === 6 && publicIpv6(address);
}

export async function assertSafeProviderUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provider URL must be a valid HTTPS URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443") ||
    !url.hostname ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal") ||
    url.hostname === "localhost"
  ) {
    throw new Error("Provider URL must use HTTPS on a public host and standard port.");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error("Provider URL resolves to a private or reserved network address.");
  }
  return url;
}
