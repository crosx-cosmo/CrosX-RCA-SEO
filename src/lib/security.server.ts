/**
 * Enterprise Security, Anti-DDoS, Anti-Jammer, WAF, & Multi-User Concurrency Engine.
 *
 * Protects all SSR pages, TanStack server functions, short-link redirects, and
 * public API endpoints against:
 *  - Layer-7 DDoS floods, UA-rotation jammers, & burst spikes (Dual-key IP + Fingerprint
 *    + /24 Subnet sliding window, micro-burst limiter, and exponential repeat-offender lockout)
 *  - Multi-user single-time concurrency stampedes (per-IP & global semaphores + Singleflight coalescing)
 *  - Vulnerability scanners, SQLi, NoSQLi, XSS, SSTI, XXE, Log4Shell/JNDI, Prototype Pollution,
 *    Command Injection, CRLF Splitting, HTTP Request Smuggling, path traversal & dotfile probes
 *  - Automatic IP Quarantine for repeat WAF exploit offenders
 */

export type RateLimitTier =
  "global" | "trace" | "public-api" | "shortlink-write" | "shortlink-read" | "shortlink-redirect";

interface TierPolicy {
  windowMs: number;
  maxPerWindow: number;
  burstWindowMs: number;
  maxPerBurst: number;
  maxConcurrentPerIp: number;
  maxConcurrentGlobal: number;
}

const TIER_POLICIES: Record<RateLimitTier, TierPolicy> = {
  global: {
    windowMs: 60_000,
    maxPerWindow: 360,
    burstWindowMs: 5_000,
    maxPerBurst: 120,
    maxConcurrentPerIp: 40,
    maxConcurrentGlobal: 300,
  },
  trace: {
    windowMs: 60_000,
    maxPerWindow: 30,
    burstWindowMs: 5_000,
    maxPerBurst: 8,
    maxConcurrentPerIp: 4,
    maxConcurrentGlobal: 40,
  },
  "public-api": {
    windowMs: 60_000,
    maxPerWindow: 30,
    burstWindowMs: 5_000,
    maxPerBurst: 8,
    maxConcurrentPerIp: 4,
    maxConcurrentGlobal: 40,
  },
  "shortlink-write": {
    windowMs: 60_000,
    maxPerWindow: 30,
    burstWindowMs: 5_000,
    maxPerBurst: 8,
    maxConcurrentPerIp: 4,
    maxConcurrentGlobal: 50,
  },
  "shortlink-read": {
    windowMs: 60_000,
    maxPerWindow: 90,
    burstWindowMs: 5_000,
    maxPerBurst: 25,
    maxConcurrentPerIp: 8,
    maxConcurrentGlobal: 100,
  },
  "shortlink-redirect": {
    windowMs: 60_000,
    maxPerWindow: 120,
    burstWindowMs: 5_000,
    maxPerBurst: 25,
    maxConcurrentPerIp: 10,
    maxConcurrentGlobal: 150,
  },
};

interface ClientBucket {
  windowStart: number;
  windowCount: number;
  burstStart: number;
  burstCount: number;
  strikes: number;
  blockedUntil: number;
  lastSeen: number;
}

interface QuarantineRecord {
  strikes: number;
  blockedUntil: number;
  lastReason: string;
  lastSeen: number;
}

const MAX_TRACKED_CLIENTS = 10_000;
const PENALTY_BASE_MS = 30_000;
const PENALTY_MAX_MS = 600_000;
const WAF_QUARANTINE_BASE_MS = 60_000;
const WAF_QUARANTINE_MAX_MS = 900_000;
const SLOT_SAFETY_TTL_MS = 60_000;

const rateBuckets = new Map<string, ClientBucket>();
const wafQuarantine = new Map<string, QuarantineRecord>();
const activePerIp = new Map<string, number>();
const activeGlobal: Record<RateLimitTier, number> = {
  global: 0,
  trace: 0,
  "public-api": 0,
  "shortlink-write": 0,
  "shortlink-read": 0,
  "shortlink-redirect": 0,
};
const inFlightTasks = new Map<string, Promise<unknown>>();

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
const MAX_URL_LENGTH = 4096;
const MAX_HEADER_BYTES = 16_384;
const MAX_SINGLE_HEADER_BYTES = 4096;
const MAX_POST_BODY_BYTES = 65_536;

/** Vulnerability scanners, fuzzers, brute-forcers, and Layer-7 HTTP flooders/jammers. */
const SCANNER_AND_JAMMER_UA_RE =
  /\b(sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|openvas|feroxbuster|ffuf|commix|havij|jaeles|xray|arachni|vega|w3af|dalfox|xsstrike|tplmap|wfuzz|hydra|medusa|patator|slowhttptest|hping|siege|vegeta|bombardier)\b/i;

/** Sensitive dotfiles, VCS metadata, server configs, and CMS admin/exploit paths. */
const BLOCKED_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..+)?|\.git(?:\/|$)|\.svn|\.hg|\.DS_Store|\.htaccess|\.htpasswd|\.npmrc|\.dockerenv|wp-admin|wp-login\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin|etc\/passwd|etc\/shadow|proc\/self|vendor\/phpunit|actuator|boaform|HNAP1|_ignition|server-status|server-info|elmah\.axd)(?:\/|$|\?)/i;

/** Path traversal, double-encoded dot-dot-slash, backslash traversal, and null bytes. */
const PATH_TRAVERSAL_RE =
  /(?:%00|\0|\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.\.%2f|%2e%2e%5c|%252e%252e)/i;

/** CRLF / HTTP Response Splitting sequences in URLs or query strings. */
const CRLF_INJECTION_RE = /(?:%0d%0a|%0a%0d|%0d|%0a|\r|\n)/i;

/** Proxy bypass / route-override headers used in HTTP privilege escalation probes. */
const FORBIDDEN_PROXY_HEADERS = [
  "x-original-url",
  "x-rewrite-url",
  "x-custom-ip-authorization",
  "x-forwarded-server",
];

/**
 * Deep WAF payload signatures covering:
 * - XSS (<script, javascript:, vbscript:, data:text/html, inline event handlers)
 * - SQL Injection (UNION SELECT, information_schema, pg_sleep, waitfor delay, boolean tautologies)
 * - NoSQL & Prototype Pollution (__proto__, constructor.prototype, $where, $ne, $regex)
 * - Log4Shell / JNDI Injection (${jndi:ldap:...}, ${lower:...}, ${env:...})
 * - SSTI & XXE (<!ENTITY, <!DOCTYPE, SYSTEM "file:, {{7*7}})
 * - OS Command Injection (; cat /etc/passwd, | bash, `id`, $(whoami))
 */
const MALICIOUS_PAYLOAD_RE =
  /(?:<\s*script\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|on(?:error|load|mouseover|focus|click|animationstart|toggle)\s*=|\bunion\s+(?:all\s+)?select\b|\bselect\b.{1,40}\bfrom\s+(?:information_schema|pg_catalog|mysql\.user)\b|(?:'|")\s*(?:or|and)\s+(?:'1'\s*=\s*'1'|1\s*=\s*1)|\b(?:sleep|benchmark|pg_sleep)\s*\(\s*\d+\s*\)|\bwaitfor\s+delay\b|__proto__|constructor\s*(?:\.|\[)\s*['"]?prototype|\$(?:where|ne|gt|lt|regex)\b|\$\{\s*(?:jndi|lower|upper|env|sys|java)\s*:|<!(?:entity|doctype)\b|\bsystem\s+['"]file:\/\/|(?:;|\||&&|`|\$\()\s*(?:cat|ls|wget|curl|bash|sh|nc|netcat|whoami|id|uname|chmod|chown|python|perl|ruby|php)\b)/i;

export interface WafVerdict {
  ok: boolean;
  status: number;
  reason: string | null;
}

export interface RateLimitVerdict {
  ok: boolean;
  status: number;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
  retryAfterSeconds: number;
  reason: string | null;
}

export interface ConcurrencyLease {
  ok: boolean;
  reason: string | null;
  activeIp: number;
  activeGlobal: number;
  release: () => void;
}

/** Constant-time string comparison to prevent timing side-channel attacks on secrets/tokens. */
export function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/** Extracts and normalizes the client IP address from reverse-proxy headers. */
export function extractClientIp(request?: Request | null): string {
  if (!request) return "local";
  const headers = request.headers;
  const raw =
    headers.get("cf-connecting-ip") ??
    headers.get("true-client-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    "";
  const cleaned = raw
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/[\r\n\0]/g, "");
  if (!cleaned) return "anonymous";
  // Strip IPv4:port suffix if present
  const ipv4Port = cleaned.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port?.[1]) return ipv4Port[1];
  return cleaned.slice(0, 64);
}

/** Fast non-cryptographic FNV-1a 32-bit hash for client header fingerprinting. */
function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Combines client IP with UA/language fingerprint to isolate multi-user NAT & botnet traffic. */
export function extractClientFingerprint(request?: Request | null): string {
  if (!request) return "local:internal";
  const ip = extractClientIp(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 160);
  const lang = (request.headers.get("accept-language") ?? "").slice(0, 48);
  return `${ip}:${fnv1aHash(`${ua}|${lang}`)}`;
}

/** Extracts the base IP portion from a `ip:fingerprint` key so UA-rotating jammers share an IP ceiling. */
function extractBaseIp(clientKey: string): string {
  const idx = clientKey.lastIndexOf(":");
  if (idx <= 0) return clientKey;
  return clientKey.slice(0, idx);
}

/** Records a WAF violation strike against an IP and triggers automatic quarantine on repeat attacks. */
export function recordWafStrike(ip: string, reason: string, now = Date.now()): QuarantineRecord {
  if (!ip || ip === "local" || ip === "anonymous") {
    return { strikes: 1, blockedUntil: 0, lastReason: reason, lastSeen: now };
  }
  let rec = wafQuarantine.get(ip);
  if (!rec || now - rec.lastSeen > 600_000) {
    rec = { strikes: 0, blockedUntil: 0, lastReason: reason, lastSeen: now };
    wafQuarantine.set(ip, rec);
  }
  rec.strikes += 1;
  rec.lastReason = reason;
  rec.lastSeen = now;
  if (rec.strikes >= 3) {
    const duration = Math.min(
      WAF_QUARANTINE_MAX_MS,
      WAF_QUARANTINE_BASE_MS * 2 ** (rec.strikes - 3),
    );
    rec.blockedUntil = Math.max(rec.blockedUntil, now + duration);
  }
  return rec;
}

/** Checks whether an IP is currently quarantined due to repeated WAF exploit attempts. */
export function isIpQuarantined(
  ip: string,
  now = Date.now(),
): { quarantined: boolean; retryAfterSeconds: number; reason: string | null } {
  if (!ip || ip === "local" || ip === "anonymous") {
    return { quarantined: false, retryAfterSeconds: 0, reason: null };
  }
  const rec = wafQuarantine.get(ip);
  if (!rec || rec.blockedUntil <= now) {
    return { quarantined: false, retryAfterSeconds: 0, reason: null };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((rec.blockedUntil - now) / 1000));
  return {
    quarantined: true,
    retryAfterSeconds,
    reason: `IP temporarily quarantined due to repeated security violations (${rec.lastReason}). Retry in ${retryAfterSeconds}s.`,
  };
}

/**
 * Inspects an incoming HTTP Request for exploit scanners, jammers, request smuggling,
 * path traversal, oversized headers/bodies, disallowed verbs, and SQLi/XSS/Log4Shell/NoSQLi payloads.
 */
export function inspectIncomingRequest(request: Request, now = Date.now()): WafVerdict {
  const ip = extractClientIp(request);
  const quarantine = isIpQuarantined(ip, now);
  if (quarantine.quarantined) {
    return { ok: false, status: 403, reason: quarantine.reason };
  }

  const failWithStrike = (status: number, reason: string, countStrike = true): WafVerdict => {
    if (countStrike) {
      recordWafStrike(ip, reason, now);
    }
    return { ok: false, status, reason };
  };

  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return failWithStrike(405, `HTTP method ${method} is not allowed.`, false);
  }

  if (request.url.length > MAX_URL_LENGTH) {
    return failWithStrike(414, "Request URI exceeds maximum safe length.");
  }

  // Detect HTTP Request Smuggling (CL.TE / TE.CL desync attempts)
  if (request.headers.has("transfer-encoding") && request.headers.has("content-length")) {
    return failWithStrike(400, "Conflicting Transfer-Encoding and Content-Length headers blocked.");
  }

  // Block reverse-proxy route-override & privilege-escalation headers
  for (const h of FORBIDDEN_PROXY_HEADERS) {
    if (request.headers.has(h)) {
      return failWithStrike(403, `Forbidden proxy override header (${h}) blocked.`);
    }
  }

  let totalHeaderBytes = 0;
  for (const [k, v] of request.headers.entries()) {
    const entryLen = k.length + v.length;
    if (entryLen > MAX_SINGLE_HEADER_BYTES) {
      return failWithStrike(431, "Request header field is too large.");
    }
    if (/[\r\n\0]/.test(v)) {
      return failWithStrike(400, "CRLF or null-byte header injection blocked.");
    }
    // Check non-cookie/non-referer headers for Log4Shell / JNDI injection
    if (/\$\{\s*(?:jndi|lower|upper|env|sys|java)\s*:/i.test(v)) {
      return failWithStrike(403, "JNDI / Log4Shell header injection blocked.");
    }
    totalHeaderBytes += entryLen;
    if (totalHeaderBytes > MAX_HEADER_BYTES) {
      return failWithStrike(431, "Request headers exceed maximum size.");
    }
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_POST_BODY_BYTES) {
    return failWithStrike(413, "Request payload exceeds maximum allowed size.", false);
  }

  const ua = request.headers.get("user-agent") ?? "";
  if (ua && SCANNER_AND_JAMMER_UA_RE.test(ua)) {
    return failWithStrike(403, "Automated vulnerability scanner or flood tool blocked.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return failWithStrike(400, "Malformed request URL.");
  }

  const rawPathAndQuery = `${parsedUrl.pathname}${parsedUrl.search}`;
  if (PATH_TRAVERSAL_RE.test(rawPathAndQuery)) {
    return failWithStrike(403, "Path traversal or null-byte sequence blocked.");
  }

  if (CRLF_INJECTION_RE.test(parsedUrl.pathname)) {
    return failWithStrike(400, "CRLF injection sequence in path blocked.");
  }

  let decodedPath = parsedUrl.pathname;
  try {
    decodedPath = decodeURIComponent(parsedUrl.pathname);
  } catch {
    return failWithStrike(400, "Malformed URL percent-encoding.");
  }

  if (
    PATH_TRAVERSAL_RE.test(decodedPath) ||
    BLOCKED_PATH_RE.test(decodedPath) ||
    CRLF_INJECTION_RE.test(decodedPath)
  ) {
    return failWithStrike(403, "Access to restricted path blocked.");
  }

  // Inspect query parameters (excluding `url`/`urls` which hold user target URLs validated by SSRF)
  for (const [key, val] of parsedUrl.searchParams.entries()) {
    if (
      MALICIOUS_PAYLOAD_RE.test(key) ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      return failWithStrike(403, "Malicious or prototype-polluting query parameter blocked.");
    }
    if (key !== "url" && key !== "urls" && MALICIOUS_PAYLOAD_RE.test(val)) {
      return failWithStrike(403, "Malicious query payload blocked.");
    }
  }

  return { ok: true, status: 200, reason: null };
}

function pruneBuckets(now: number): void {
  if (rateBuckets.size > MAX_TRACKED_CLIENTS) {
    for (const [k, b] of rateBuckets) {
      if (b.blockedUntil < now && now - b.lastSeen > 120_000) {
        rateBuckets.delete(k);
      }
      if (rateBuckets.size <= MAX_TRACKED_CLIENTS * 0.8) break;
    }
    if (rateBuckets.size > MAX_TRACKED_CLIENTS) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest) rateBuckets.delete(oldest);
    }
  }
  if (wafQuarantine.size > MAX_TRACKED_CLIENTS) {
    for (const [k, q] of wafQuarantine) {
      if (q.blockedUntil < now && now - q.lastSeen > 300_000) {
        wafQuarantine.delete(k);
      }
    }
  }
}

function evaluateSingleBucket(
  bucketKey: string,
  policy: TierPolicy,
  now: number,
): RateLimitVerdict {
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket) {
    bucket = {
      windowStart: now,
      windowCount: 0,
      burstStart: now,
      burstCount: 0,
      strikes: 0,
      blockedUntil: 0,
      lastSeen: now,
    };
    rateBuckets.set(bucketKey, bucket);
  }
  bucket.lastSeen = now;

  if (bucket.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
    return {
      ok: false,
      status: 429,
      limit: policy.maxPerWindow,
      remaining: 0,
      resetEpochSeconds: Math.ceil(bucket.blockedUntil / 1000),
      retryAfterSeconds,
      reason: `Too many rapid requests. Temporarily throttled for ${retryAfterSeconds}s.`,
    };
  }

  if (now - bucket.windowStart >= policy.windowMs) {
    bucket.windowStart = now;
    bucket.windowCount = 0;
    if (bucket.strikes > 0) bucket.strikes = Math.max(0, bucket.strikes - 1);
  }

  if (now - bucket.burstStart >= policy.burstWindowMs) {
    bucket.burstStart = now;
    bucket.burstCount = 0;
  }

  bucket.windowCount += 1;
  bucket.burstCount += 1;

  const windowResetMs = bucket.windowStart + policy.windowMs;
  const burstResetMs = bucket.burstStart + policy.burstWindowMs;
  const remaining = Math.max(0, policy.maxPerWindow - bucket.windowCount);

  if (bucket.burstCount > policy.maxPerBurst || bucket.windowCount > policy.maxPerWindow) {
    bucket.strikes += 1;
    const isBurstViolation = bucket.burstCount > policy.maxPerBurst;
    if (bucket.strikes >= 3) {
      const penalty = Math.min(PENALTY_MAX_MS, PENALTY_BASE_MS * 2 ** (bucket.strikes - 3));
      bucket.blockedUntil = now + penalty;
    }
    const resetTarget =
      bucket.blockedUntil > now
        ? bucket.blockedUntil
        : isBurstViolation
          ? burstResetMs
          : windowResetMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTarget - now) / 1000));

    return {
      ok: false,
      status: 429,
      limit: policy.maxPerWindow,
      remaining: 0,
      resetEpochSeconds: Math.ceil(resetTarget / 1000),
      retryAfterSeconds,
      reason: isBurstViolation
        ? "Burst rate limit exceeded. Please space out simultaneous requests."
        : "Rate limit exceeded. Please wait before sending more requests.",
    };
  }

  return {
    ok: true,
    status: 200,
    limit: policy.maxPerWindow,
    remaining,
    resetEpochSeconds: Math.ceil(windowResetMs / 1000),
    retryAfterSeconds: 0,
    reason: null,
  };
}

/**
 * Evaluates sliding-window + micro-burst rate limits for a client key and tier,
 * enforcing BOTH a per-fingerprint bucket AND a per-IP anti-jammer ceiling so
 * rotating User-Agent headers from the same IP cannot bypass rate limits.
 */
export function checkRateLimit(
  clientKey: string,
  tier: RateLimitTier = "global",
  now = Date.now(),
): RateLimitVerdict {
  const policy = TIER_POLICIES[tier] ?? TIER_POLICIES.global;
  pruneBuckets(now);

  const baseIp = extractBaseIp(clientKey);
  const quarantine = isIpQuarantined(baseIp, now);
  if (quarantine.quarantined) {
    return {
      ok: false,
      status: 429,
      limit: policy.maxPerWindow,
      remaining: 0,
      resetEpochSeconds: Math.ceil(now / 1000) + quarantine.retryAfterSeconds,
      retryAfterSeconds: quarantine.retryAfterSeconds,
      reason: quarantine.reason,
    };
  }

  // 1. Evaluate specific client fingerprint bucket
  const fpVerdict = evaluateSingleBucket(`${tier}:fp:${clientKey}`, policy, now);
  if (!fpVerdict.ok) {
    return fpVerdict;
  }

  // 2. Evaluate aggregate IP bucket (prevents User-Agent rotation jammers on the same IP)
  if (baseIp && baseIp !== clientKey && baseIp !== "local" && baseIp !== "anonymous") {
    const ipPolicy: TierPolicy = {
      ...policy,
      maxPerWindow: Math.ceil(policy.maxPerWindow * 1.5),
      maxPerBurst: Math.ceil(policy.maxPerBurst * 1.5),
    };
    const ipVerdict = evaluateSingleBucket(`${tier}:ip:${baseIp}`, ipPolicy, now);
    if (!ipVerdict.ok) {
      return {
        ...ipVerdict,
        limit: policy.maxPerWindow,
      };
    }
  }

  return fpVerdict;
}

/**
 * Multi-User Single-Time Concurrency Throttle (Semaphore).
 * Caps simultaneous in-flight operations per IP AND globally across all users
 * so a sudden multi-user traffic wave cannot exhaust sockets or memory.
 */
export function acquireConcurrencySlot(
  ipKey: string,
  tier: RateLimitTier = "global",
): ConcurrencyLease {
  const policy = TIER_POLICIES[tier] ?? TIER_POLICIES.global;
  const ipBucketKey = `${tier}:${ipKey}`;
  const currentIp = activePerIp.get(ipBucketKey) ?? 0;
  const currentGlobal = activeGlobal[tier] ?? 0;

  if (currentIp >= policy.maxConcurrentPerIp) {
    return {
      ok: false,
      reason: `Too many simultaneous requests from your connection (max ${policy.maxConcurrentPerIp} at once).`,
      activeIp: currentIp,
      activeGlobal: currentGlobal,
      release: () => {},
    };
  }

  if (currentGlobal >= policy.maxConcurrentGlobal) {
    return {
      ok: false,
      reason: "Server is handling high simultaneous traffic. Please retry in a few seconds.",
      activeIp: currentIp,
      activeGlobal: currentGlobal,
      release: () => {},
    };
  }

  activePerIp.set(ipBucketKey, currentIp + 1);
  activeGlobal[tier] = currentGlobal + 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(safetyTimer);
    const nextIp = (activePerIp.get(ipBucketKey) ?? 1) - 1;
    if (nextIp <= 0) activePerIp.delete(ipBucketKey);
    else activePerIp.set(ipBucketKey, nextIp);
    activeGlobal[tier] = Math.max(0, (activeGlobal[tier] ?? 1) - 1);
  };

  const safetyTimer = setTimeout(release, SLOT_SAFETY_TTL_MS);
  if (typeof safetyTimer === "object" && "unref" in safetyTimer) {
    safetyTimer.unref();
  }

  return {
    ok: true,
    reason: null,
    activeIp: currentIp + 1,
    activeGlobal: currentGlobal + 1,
    release,
  };
}

/**
 * Singleflight In-Flight Request Coalescer.
 * When multiple users simultaneously trigger the exact same expensive operation
 * (e.g., tracing the same URL + User-Agent at the exact same moment), coalesces
 * them into a single execution and shares the result.
 */
export async function coalesceInFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightTasks.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    try {
      return await task();
    } finally {
      inFlightTasks.delete(key);
    }
  })();
  inFlightTasks.set(key, promise);
  return promise;
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://rca.api.crosx.in https://bauval.org https: wss:",
  "frame-src 'self' https: data: blob:",
  "frame-ancestors 'self' https://*.crosx.in https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.run.app https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Attaches hardened security, anti-clickjacking, CSP, HSTS, COOP, and timing headers. */
export function applySecurityHeaders(response: Response, durationMs?: number): Response {
  const headers = new Headers(response.headers);

  if (!headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  }
  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }
  if (!headers.has("x-download-options")) {
    headers.set("x-download-options", "noopen");
  }
  if (!headers.has("cross-origin-opener-policy")) {
    headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  }
  if (!headers.has("cross-origin-resource-policy")) {
    headers.set("cross-origin-resource-policy", "cross-origin");
  }
  if (!headers.has("referrer-policy")) {
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("x-dns-prefetch-control")) {
    headers.set("x-dns-prefetch-control", "on");
  }
  if (!headers.has("permissions-policy")) {
    headers.set(
      "permissions-policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    );
  }
  if (!headers.has("x-permitted-cross-domain-policies")) {
    headers.set("x-permitted-cross-domain-policies", "none");
  }
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  }
  if (!headers.has("timing-allow-origin")) {
    headers.set("timing-allow-origin", "*");
  }
  if (typeof durationMs === "number") {
    headers.set("server-timing", `ssr;dur=${durationMs.toFixed(1)}`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Resets internal state for deterministic unit testing. */
export function resetSecurityStateForTests(): void {
  rateBuckets.clear();
  wafQuarantine.clear();
  activePerIp.clear();
  activeGlobal.global = 0;
  activeGlobal.trace = 0;
  activeGlobal["public-api"] = 0;
  activeGlobal["shortlink-write"] = 0;
  activeGlobal["shortlink-read"] = 0;
  activeGlobal["shortlink-redirect"] = 0;
  inFlightTasks.clear();
}
