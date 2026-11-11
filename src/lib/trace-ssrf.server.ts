/**
 * SSRF protection for the trace engine.
 *
 * Every destination — the user's input and every hop discovered afterwards —
 * must pass `assertSafeUrl` before a request is made to it. Hostnames are
 * resolved over DNS-over-HTTPS and the resulting addresses are checked against
 * loopback / private / reserved ranges, so a public hostname that points at an
 * internal address is rejected too.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443", "8000"]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".onion",
  ".corp",
  ".lan",
  ".intranet",
  ".localdomain",
];

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
  "100.100.100.200", // Alibaba Cloud metadata
  "192.0.0.192", // Oracle Cloud metadata
]);

export interface UrlVerdict {
  ok: boolean;
  /** Exact, user-facing reason when `ok` is false. */
  reason: string | null;
  url: URL | null;
  addresses: string[];
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function intToIpv4(value: number): string {
  const u = value >>> 0;
  return `${(u >>> 24) & 0xff}.${(u >>> 16) & 0xff}.${(u >>> 8) & 0xff}.${u & 0xff}`;
}

/** IPv4 ranges that must never be reachable from the analyzer. */
const V4_BLOCKS: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "unspecified range"],
  ["10.0.0.0", 8, "private network"],
  ["100.64.0.0", 10, "carrier-grade NAT range"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud metadata range"],
  ["172.16.0.0", 12, "private network"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation range"],
  ["192.168.0.0", 16, "private network"],
  ["198.18.0.0", 15, "benchmarking range"],
  ["198.51.100.0", 24, "documentation range"],
  ["203.0.113.0", 24, "documentation range"],
  ["224.0.0.0", 4, "multicast range"],
  ["240.0.0.0", 4, "reserved range"],
];

function parseIpv6Words(raw: string): number[] | null {
  const noZone = raw.split("%")[0] ?? "";
  let addr = noZone.replace(/^\[|\]$/g, "");
  if (!addr.includes(":")) return null;

  // Expand embedded IPv4 suffix (e.g. ::ffff:127.0.0.1 or ::192.168.1.1) into 2 hex words
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const dblParts = addr.split("::");
  if (dblParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const out: number[] = [];
    for (const t of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(t)) return null;
      out.push(parseInt(t, 16));
    }
    return out;
  };

  if (dblParts.length === 2) {
    const left = parseSide(dblParts[0]!);
    const right = parseSide(dblParts[1]!);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array<number>(missing).fill(0), ...right];
  }

  const full = parseSide(addr);
  if (!full || full.length !== 8) return null;
  return full;
}

export function classifyIp(ip: string): string | null {
  const clean = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (clean.includes(":")) {
    const words = parseIpv6Words(clean);
    if (!words) return "malformed IPv6 address";

    const isAllZeroPrefix = (count: number) => words.slice(0, count).every((w) => w === 0);

    // ::/128 unspecified & ::1/128 loopback (including expanded 0:0:0:0:0:0:0:1)
    if (isAllZeroPrefix(7) && (words[7] === 0 || words[7] === 1)) {
      return "loopback / unspecified address";
    }

    // IPv4-mapped ::ffff:0:0/96 or IPv4-compatible ::/96 or IPv4-translated ::ffff:0:0:0/96
    if (
      (isAllZeroPrefix(5) && (words[5] === 0xffff || words[5] === 0)) ||
      (isAllZeroPrefix(4) && words[4] === 0xffff && words[5] === 0)
    ) {
      const v4Int = ((words[6]! << 16) | words[7]!) >>> 0;
      return classifyIp(intToIpv4(v4Int)) ?? "IPv4-mapped / compatible address";
    }

    // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    if (words[0] === 0x0064 && words[1] === 0xff9b) {
      const v4Int = ((words[6]! << 16) | words[7]!) >>> 0;
      return classifyIp(intToIpv4(v4Int)) ?? "NAT64 translated address";
    }

    const w0 = words[0]!;
    const w1 = words[1]!;

    // 6to4 2002::/16 embeds IPv4 in words[1..2]
    if (w0 === 0x2002) {
      const v4Int = ((w1 << 16) | words[2]!) >>> 0;
      return classifyIp(intToIpv4(v4Int)) ?? "6to4 tunnel address";
    }

    // Teredo 2001:0000::/32, Benchmarking 2001:0002::/48, Documentation 2001:0db8::/32, ORCHID 2001:10::/28
    if (w0 === 0x2001) {
      if (w1 === 0x0000) return "Teredo tunnel address";
      if (w1 === 0x0002 && words[2] === 0x0000) return "benchmarking range";
      if (w1 === 0x0db8) return "documentation range";
      if ((w1 & 0xfff0) === 0x0010 || (w1 & 0xfff0) === 0x0020) return "ORCHID range";
    }

    if ((w0 & 0xfe00) === 0xfc00) return "unique local address";
    if ((w0 & 0xffc0) === 0xfe80) return "link-local address";
    if ((w0 & 0xffc0) === 0xfec0) return "site-local address";
    if ((w0 & 0xff00) === 0xff00) return "multicast address";
    return null;
  }

  const value = ipv4ToInt(clean);
  if (value === null) return "malformed IPv4 address";
  for (const [base, bits, label] of V4_BLOCKS) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return label;
  }
  return null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

interface DohAnswer {
  Answer?: Array<{ type: number; data: string }>;
}

function getDohEndpoint(): string {
  const envEndpoint =
    typeof process !== "undefined" ? process.env["DOH_ENDPOINT"]?.trim() : undefined;
  return envEndpoint || "https://cloudflare-dns.com/dns-query";
}

async function resolve(host: string, type: "A" | "AAAA", timeoutMs: number): Promise<string[]> {
  const dohBase = getDohEndpoint();
  const sep = dohBase.includes("?") ? "&" : "?";
  const response = await fetch(`${dohBase}${sep}name=${encodeURIComponent(host)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`DNS lookup returned ${response.status}`);
  const payload = (await response.json()) as DohAnswer;
  const wanted = type === "A" ? 1 : 28;
  return (payload.Answer ?? []).filter((a) => a.type === wanted).map((a) => a.data);
}

const DNS_CACHE_TTL_MS = 60_000;
const DNS_CACHE_MAX_SIZE = 500;
const dnsCache = new Map<string, { addresses: string[]; expiresAt: number }>();

async function resolveHostAddresses(host: string, timeoutMs: number): Promise<string[]> {
  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > now) {
    return cached.addresses;
  }

  let addresses: string[] = [];
  try {
    const [a, aaaa] = await Promise.all([
      resolve(host, "A", timeoutMs).catch(() => [] as string[]),
      resolve(host, "AAAA", timeoutMs).catch(() => [] as string[]),
    ]);
    addresses = [...a, ...aaaa];
  } catch {
    addresses = [];
  }

  if (addresses.length > 0) {
    if (dnsCache.size >= DNS_CACHE_MAX_SIZE) {
      const oldestKey = dnsCache.keys().next().value;
      if (oldestKey) dnsCache.delete(oldestKey);
    }
    dnsCache.set(host, { addresses, expiresAt: now + DNS_CACHE_TTL_MS });
  }
  return addresses;
}

export async function assertSafeUrl(raw: string, timeoutMs = 5000): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid absolute URL.", url: null, addresses: [] };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: "Blocked: URLs with embedded credentials (username/password) are not allowed.",
      url,
      addresses: [],
    };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return {
      ok: false,
      reason: `Blocked: only http and https can be followed (found "${url.protocol.replace(":", "")}").`,
      url,
      addresses: [],
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      ok: false,
      reason: `Blocked: port ${url.port} is not allowed.`,
      url,
      addresses: [],
    };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, reason: "Blocked: the URL has no hostname.", url, addresses: [] };
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return {
      ok: false,
      reason: `Blocked: "${host}" is a local or internal hostname.`,
      url,
      addresses: [],
    };
  }

  if (isIpLiteral(host)) {
    const classification = classifyIp(host);
    if (classification) {
      return {
        ok: false,
        reason: `Blocked: ${host} is in a ${classification}.`,
        url,
        addresses: [host],
      };
    }
    return { ok: true, reason: null, url, addresses: [host] };
  }

  const addresses = await resolveHostAddresses(host, timeoutMs);

  if (!addresses.length) {
    return {
      ok: false,
      reason: `Blocked: "${host}" could not be resolved to a public IP address, so it cannot be verified as safe.`,
      url,
      addresses: [],
    };
  }

  for (const address of addresses) {
    const classification = classifyIp(address);
    if (classification) {
      return {
        ok: false,
        reason: `Blocked: "${host}" resolves to ${address}, which is in a ${classification}.`,
        url,
        addresses,
      };
    }
  }

  return { ok: true, reason: null, url, addresses };
}
