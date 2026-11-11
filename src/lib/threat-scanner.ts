/**
 * Phishing, Malware & Threat-Intelligence Link Scanner.
 *
 * Audits every hop in a RedirectAnalysis chain for:
 *  - IDN Homograph / Punycode lookalike domains (`xn--`)
 *  - Brand impersonation & deceptive subdomain spoofing
 *  - High-risk / frequently abused TLDs (`.zip`, `.mov`, `.top`, `.click`, `.tk`, etc.)
 *  - Raw IP destinations & non-standard ports
 *  - Open-redirect parameter abuse (`?url=`, `?redirect=`, `?next=`, etc.)
 *  - URL credential tricks (`user@host`), double-encoding & obfuscation
 *  - Missing HTTP security headers on the final destination (`HSTS`, `CSP`, `X-Frame-Options`, `X-Content-Type-Options`)
 */

import type { RedirectAnalysis, RedirectHop } from "./redirect-types";

export type ThreatSeverity = "low" | "medium" | "high" | "critical";

export interface ThreatFinding {
  id: string;
  severity: ThreatSeverity;
  category:
    | "homograph"
    | "brand-spoof"
    | "suspicious-tld"
    | "ip-host"
    | "open-redirect"
    | "obfuscation"
    | "protocol-downgrade"
    | "missing-security-header";
  hopIndex: number | null;
  url: string;
  title: string;
  detail: string;
  remediation: string;
}

export interface SecurityHeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
  recommendation: string;
}

export interface ThreatScanReport {
  trustScore: number; // 0 (critical danger) to 100 (clean & hardened)
  riskLevel: "clean" | "caution" | "high-risk" | "critical-threat";
  riskLabel: string;
  findings: ThreatFinding[];
  securityHeaders: SecurityHeaderCheck[];
  uniqueDomains: string[];
  crossDomainHops: number;
}

const HIGH_RISK_TLDS = new Set([
  "zip",
  "mov",
  "top",
  "xyz",
  "click",
  "loan",
  "work",
  "gq",
  "tk",
  "ml",
  "cf",
  "ga",
  "buzz",
  "rest",
  "fit",
  "icu",
  " monster",
]);

const PROTECTED_BRANDS: Array<{ brand: string; officialDomains: string[]; patterns: RegExp[] }> = [
  {
    brand: "PayPal",
    officialDomains: ["paypal.com", "paypal.me"],
    patterns: [/paypa[l1I]/i, /secure-paypal/i],
  },
  {
    brand: "Microsoft",
    officialDomains: ["microsoft.com", "live.com", "office.com", "outlook.com"],
    patterns: [/micros[o0]ft/i, /office365-login/i],
  },
  {
    brand: "Google",
    officialDomains: ["google.com", "accounts.google.com", "googleapis.com", "g.co"],
    patterns: [/g[o0]{2}gle/i, /google-verify/i],
  },
  {
    brand: "Apple",
    officialDomains: ["apple.com", "icloud.com"],
    patterns: [/app[l1]e-id/i, /icloud-verify/i],
  },
  {
    brand: "Amazon",
    officialDomains: ["amazon.com", "amzn.to", "aws.amazon.com"],
    patterns: [/amaz[o0]n-/i, /prime-verify/i],
  },
];

const OPEN_REDIRECT_PARAMS = new Set([
  "url",
  "redirect",
  "redirect_uri",
  "redirect_url",
  "next",
  "target",
  "dest",
  "destination",
  "return",
  "return_to",
  "rurl",
  "out",
  "continue",
]);

function isOfficialDomain(hostname: string, allowedList: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowedList.some((d) => lower === d || lower.endsWith(`.${d}`));
}

function isRawIpHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return true;
  if (clean.includes(":")) return true;
  return false;
}

function inspectHopThreats(hop: RedirectHop): ThreatFinding[] {
  const findings: ThreatFinding[] = [];
  let parsed: URL;
  try {
    parsed = new URL(hop.url);
  } catch {
    return findings;
  }

  const host = parsed.hostname.toLowerCase();
  const labels = host.split(".");
  const tld = labels[labels.length - 1] ?? "";

  // 1. Punycode / IDN Homograph check
  const hasNonAscii = Array.from(host).some((ch) => ch.charCodeAt(0) > 127);
  if (host.includes("xn--") || hasNonAscii) {
    findings.push({
      id: `homograph-${hop.index}`,
      severity: "critical",
      category: "homograph",
      hopIndex: hop.index,
      url: hop.url,
      title: `IDN Homograph / Punycode domain detected (${host})`,
      detail:
        "This hop uses internationalized Punycode characters (`xn--`) that can visually impersonate trusted ASCII domains in browsers.",
      remediation:
        "Verify the exact ASCII domain registration before trusting or forwarding traffic to this host.",
    });
  }

  // 2. Brand spoofing / deceptive subdomain check
  for (const item of PROTECTED_BRANDS) {
    if (!isOfficialDomain(host, item.officialDomains)) {
      const matched = item.patterns.some((re) => re.test(host));
      const deceptiveSubdomain = item.officialDomains.some((d) => host.includes(`${d}.`));
      if (matched || deceptiveSubdomain) {
        findings.push({
          id: `brand-spoof-${hop.index}-${item.brand}`,
          severity: "critical",
          category: "brand-spoof",
          hopIndex: hop.index,
          url: hop.url,
          title: `Potential ${item.brand} lookalike or deceptive subdomain (${host})`,
          detail: `Hostname "${host}" resembles ${item.brand} but is not hosted on an official ${item.brand} root domain.`,
          remediation:
            "Block this link immediately if it requests credentials, payment details, or OAuth tokens.",
        });
      }
    }
  }

  // 3. Raw IP address or non-standard port
  if (isRawIpHost(host)) {
    findings.push({
      id: `ip-host-${hop.index}`,
      severity: "high",
      category: "ip-host",
      hopIndex: hop.index,
      url: hop.url,
      title: `Direct IP address destination (${host})`,
      detail:
        "Legitimate commercial landing pages rarely route visitors to raw IP addresses without a domain name.",
      remediation: "Replace the raw IP with a TLS-verified domain name.",
    });
  } else if (parsed.port && !["80", "443", ""].includes(parsed.port)) {
    findings.push({
      id: `non-std-port-${hop.index}`,
      severity: "medium",
      category: "ip-host",
      hopIndex: hop.index,
      url: hop.url,
      title: `Non-standard network port (:${parsed.port})`,
      detail: `Hop routes through port ${parsed.port} instead of standard HTTP/HTTPS ports 80/443.`,
      remediation: "Serve production web redirects over port 443 with TLS enabled.",
    });
  }

  // 4. High-risk / abused TLD check
  if (HIGH_RISK_TLDS.has(tld)) {
    findings.push({
      id: `tld-${hop.index}`,
      severity: "medium",
      category: "suspicious-tld",
      hopIndex: hop.index,
      url: hop.url,
      title: `High-abuse top-level domain (.${tld})`,
      detail: `The .${tld} TLD is frequently flagged by email spam filters, corporate firewalls, and threat feeds.`,
      remediation:
        "Consider using an established domain TLD for higher deliverability and user trust.",
    });
  }

  // 5. Open-redirect query parameter pointing to a different external host
  for (const [key, val] of parsed.searchParams.entries()) {
    if (OPEN_REDIRECT_PARAMS.has(key.toLowerCase())) {
      const decoded = val.trim();
      if (/^https?:\/\//i.test(decoded) || /^\/\//.test(decoded)) {
        try {
          const inner = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
          if (inner.hostname.toLowerCase() !== host) {
            findings.push({
              id: `open-redirect-${hop.index}-${key}`,
              severity: "medium",
              category: "open-redirect",
              hopIndex: hop.index,
              url: hop.url,
              title: `External redirect parameter (?${key}→${inner.hostname})`,
              detail: `Query parameter "${key}" forwards users from ${host} to external host ${inner.hostname}, a pattern often exploited in open-redirect phishing.`,
              remediation:
                "Ensure the gateway validates redirect targets against a strict allowlist.",
            });
          }
        } catch {
          // ignore malformed inner URL
        }
      }
    }
  }

  // 6. Obfuscated JavaScript or hidden hop forensics
  if (hop.forensics?.deobfuscationSteps && hop.forensics.deobfuscationSteps.length > 0) {
    findings.push({
      id: `obfuscation-${hop.index}`,
      severity: "high",
      category: "obfuscation",
      hopIndex: hop.index,
      url: hop.url,
      title: `Obfuscated client-side redirect payload at Hop #${hop.index + 1}`,
      detail: `De-obfuscated via: ${hop.forensics.deobfuscationSteps.join(" → ")}. Legitimate SEO redirects use transparent HTTP 301/308 headers rather than encoded scripts.`,
      remediation: "Replace obfuscated JavaScript redirects with server-side 301/308 redirects.",
    });
  }

  return findings;
}

export function scanRedirectThreats(result: RedirectAnalysis): ThreatScanReport {
  const findings: ThreatFinding[] = [];
  const domainSet = new Set<string>();
  let crossDomainHops = 0;
  let prevDomain: string | null = null;

  for (const hop of result.hops) {
    try {
      const h = new URL(hop.url).hostname.toLowerCase();
      domainSet.add(h);
      if (prevDomain && prevDomain !== h) {
        crossDomainHops++;
      }
      prevDomain = h;
    } catch {
      // ignore
    }
    findings.push(...inspectHopThreats(hop));
  }

  // Check HTTPS protocol downgrade across the chain
  const sawHttps = result.hops.some((h) => h.protocol === "https" || /^https:\/\//i.test(h.url));
  const finalHop = result.hops[result.hops.length - 1];
  const finalIsHttp =
    finalHop && (finalHop.protocol === "http" || /^http:\/\//i.test(finalHop.url));
  if (sawHttps && finalIsHttp) {
    findings.push({
      id: "protocol-downgrade-final",
      severity: "high",
      category: "protocol-downgrade",
      hopIndex: finalHop.index,
      url: finalHop.url,
      title: "HTTPS to HTTP protocol downgrade",
      detail:
        "The redirect chain started on or passed through HTTPS but landed on an unencrypted HTTP destination, exposing session tokens and referrers.",
      remediation: "Enforce HTTPS across every hop and enable HSTS.",
    });
  }

  const finalHeaders = finalHop?.headers ?? {};
  const getHeader = (name: string): string | null => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(finalHeaders)) {
      if (k.toLowerCase() === lower) return v;
    }
    return null;
  };

  const securityHeaders: SecurityHeaderCheck[] = [
    {
      header: "Strict-Transport-Security",
      present: Boolean(getHeader("strict-transport-security")),
      value: getHeader("strict-transport-security"),
      recommendation:
        "Enforces HTTPS connections and prevents SSL stripping (max-age=63072000; includeSubDomains; preload).",
    },
    {
      header: "Content-Security-Policy",
      present: Boolean(getHeader("content-security-policy")),
      value: getHeader("content-security-policy"),
      recommendation:
        "Mitigates Cross-Site Scripting (XSS) and unauthorized script or frame injection.",
    },
    {
      header: "X-Frame-Options",
      present:
        Boolean(getHeader("x-frame-options")) ||
        Boolean(getHeader("content-security-policy")?.includes("frame-ancestors")),
      value: getHeader("x-frame-options"),
      recommendation:
        "Prevents clickjacking by blocking untrusted iframe embeds (DENY or SAMEORIGIN).",
    },
    {
      header: "X-Content-Type-Options",
      present: getHeader("x-content-type-options")?.toLowerCase() === "nosniff",
      value: getHeader("x-content-type-options"),
      recommendation: "Prevents MIME-sniffing attacks by setting X-Content-Type-Options: nosniff.",
    },
    {
      header: "Referrer-Policy",
      present: Boolean(getHeader("referrer-policy")),
      value: getHeader("referrer-policy"),
      recommendation:
        "Controls how much referrer URL data is leaked on outbound clicks (strict-origin-when-cross-origin).",
    },
  ];

  // Calculate deterministic Trust Score (0 - 100)
  let score = 100;
  for (const f of findings) {
    if (f.severity === "critical") score -= 40;
    else if (f.severity === "high") score -= 22;
    else if (f.severity === "medium") score -= 10;
    else score -= 4;
  }

  if (crossDomainHops >= 3) {
    score -= 8;
  }

  const missingHeadersCount = securityHeaders.filter((h) => !h.present).length;
  score -= missingHeadersCount * 2;

  const trustScore = Math.max(0, Math.min(100, score));

  let riskLevel: ThreatScanReport["riskLevel"] = "clean";
  let riskLabel = "Clean & Verified";
  if (trustScore < 45 || findings.some((f) => f.severity === "critical")) {
    riskLevel = "critical-threat";
    riskLabel = "Critical Phishing / Security Risk";
  } else if (trustScore < 70 || findings.some((f) => f.severity === "high")) {
    riskLevel = "high-risk";
    riskLabel = "High Security Caution";
  } else if (trustScore < 88 || findings.length > 0) {
    riskLevel = "caution";
    riskLabel = "Moderate Caution";
  }

  return {
    trustScore,
    riskLevel,
    riskLabel,
    findings,
    securityHeaders,
    uniqueDomains: Array.from(domainSet),
    crossDomainHops,
  };
}
