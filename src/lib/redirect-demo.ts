import { assemble, paramsOf, protocolOf, redirectTypeLabel } from "./redirect-analysis";
import type { HopForensics, HopMechanism, RedirectAnalysis, RedirectHop } from "./redirect-types";

interface DemoHopSeed {
  url: string;
  status: number;
  statusText: string;
  time: number;
  location?: string;
  server?: string;
  ip?: string;
  mechanism?: HopMechanism;
  mechanismLabel?: string;
  mechanismDetail?: string;
  evidence?: string;
  forensics?: HopForensics;
}

const SEEDS: DemoHopSeed[] = [
  {
    url: "http://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    status: 301,
    statusText: "Moved Permanently",
    time: 118,
    location:
      "https://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    server: "nginx/1.24.0",
    ip: "203.0.113.10",
    forensics: {
      cookiesSet: [
        {
          name: "aff_click_sid",
          valuePreview: "abc123_5541",
          flags: ["Secure", "HttpOnly", "SameSite=Lax"],
        },
      ],
    },
  },
  {
    url: "https://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    status: 302,
    statusText: "Found",
    time: 246,
    location:
      "https://tracker.example/r/9f2?click_id=abc123&aff_id=5541&sub2=retarget&utm_source=demo&u=aHR0cHM6Ly9zaG9wLmV4YW1wbGUvbGFuZGluZz91dG1fc291cmNlPWRlbW8=",
    server: "cloudflare",
    ip: "198.51.100.24",
    forensics: {
      cookiesSent: ["aff_click_sid"],
      cookiesSet: [
        { name: "cf_trk_gate", valuePreview: "verified_human", flags: ["Secure", "SameSite=None"] },
      ],
      refererSent:
        "http://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
    },
  },
  {
    url: "https://tracker.example/r/9f2?click_id=abc123&aff_id=5541&sub2=retarget&utm_source=demo&u=aHR0cHM6Ly9zaG9wLmV4YW1wbGUvbGFuZGluZz91dG1fc291cmNlPWRlbW8=",
    status: 307,
    statusText: "Temporary Redirect",
    time: 1720,
    location: "https://shop.example/landing?utm_source=demo",
    server: "envoy",
    ip: "198.51.100.77",
    forensics: {
      refererSent:
        "https://demo-offer.example/go?click_id=abc123&aff_id=5541&sub1=newsletter&utm_source=demo&utm_campaign=spring",
      embeddedTargets: [
        {
          source: 'Query param "u" (Base64)',
          url: "https://shop.example/landing?utm_source=demo",
          encoding: "base64",
        },
      ],
      deobfuscationSteps: [
        'Decoded Base64 query parameter "u" → https://shop.example/landing?utm_source=demo',
        "Verified 307 Location header matches decoded Base64 destination",
      ],
    },
  },
  {
    url: "https://shop.example/landing?utm_source=demo",
    status: 200,
    statusText: "OK",
    time: 312,
    server: "AmazonS3",
    ip: "192.0.2.55",
    forensics: {
      refererSent:
        "https://tracker.example/r/9f2?click_id=abc123&aff_id=5541&sub2=retarget&utm_source=demo&u=aHR0cHM6Ly9zaG9wLmV4YW1wbGUvbGFuZGluZz91dG1fc291cmNlPWRlbW8=",
      hiddenArtifacts: [
        {
          kind: "form-action",
          label: "HTML <form action>",
          url: "https://shop.example/checkout/express",
        },
        {
          kind: "data-url",
          label: "data-url (Base64 decoded)",
          url: "https://shop.example/api/pixel/conversion?campaign=spring",
        },
      ],
    },
  },
];

export function buildDemoAnalysis(startUrl: string): RedirectAnalysis {
  const hops: RedirectHop[] = SEEDS.map((seed, index) => ({
    index,
    url: seed.url,
    protocol: protocolOf(seed.url),
    status: seed.status,
    statusText: seed.statusText,
    redirectType: redirectTypeLabel(seed.status),
    responseTimeMs: seed.time,
    location: seed.location ?? null,
    resolvedLocation: seed.location ?? null,
    nextUrl: seed.location ?? null,
    server: seed.server ?? null,
    ip: seed.ip ?? null,
    mechanism: seed.mechanism,
    mechanismLabel: seed.mechanismLabel,
    mechanismDetail: seed.mechanismDetail ?? null,
    evidence: seed.evidence ?? null,
    forensics: seed.forensics,
    headers: {
      date: "Thu, 03 Sep 2026 06:55:00 GMT",
      "content-type": seed.status === 200 ? "text/html; charset=utf-8" : "text/html",
      server: seed.server ?? "unknown",
      ...(seed.location ? { location: seed.location } : {}),
      "cache-control": seed.status === 301 ? "public, max-age=3600" : "no-store",
    },
    params: paramsOf(seed.url),
  }));

  const analysis = assemble({
    startUrl,
    hops,
    redirectLoop: false,
    truncated: false,
    page: {
      canonical: "https://shop.example/landing",
      metaRobots: "index, follow",
      title: "Spring Performance Collection — Official Store | Shop.Example",
      description:
        "Explore the Spring Performance Collection with free express shipping, verified attribution, and 30-day returns.",
      ogTitle: "Spring Performance Collection — Up to 40% Off",
      ogDescription:
        "Direct-to-consumer seasonal drop. Verified canonical landing page for campaign attribution.",
      twitterCard: "summary_large_image",
      hreflangCount: 3,
    },
    source: "demo",
  });

  return analysis;
}
