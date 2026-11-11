import { CROSX_LOGO_URL, CROSX_SITE_URL } from "./brand";

const rawEnvSiteUrl =
  (import.meta.env?.["VITE_SITE_URL"] as string | undefined)?.trim() ||
  (typeof process !== "undefined" ? process.env["SITE_URL"]?.trim() : undefined);

const resolvedSiteUrl =
  rawEnvSiteUrl && !rawEnvSiteUrl.endsWith(".lovable.app") ? rawEnvSiteUrl : CROSX_SITE_URL;

export const SITE_URL = resolvedSiteUrl.replace(/\/+$/, "");
export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return "rca.crosx.in";
  }
})();
export const SITE_NAME = "Redirect Chain Analyzer — CROSX";
export const BRAND_NAME = "CROSX";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/icons/icon-512.png`;
export const DEFAULT_OG_IMAGE_ALT =
  "Redirect Chain Analyzer by CROSX — Trace HTTP 301/302/307/308, Meta Refresh & JavaScript Redirects";

export const CORE_KEYWORDS = [
  "redirect chain analyzer",
  "redirect checker",
  "url redirect tracer",
  "301 redirect checker",
  "302 redirect checker",
  "307 308 redirect analyzer",
  "meta refresh redirect checker",
  "javascript redirect detector",
  "hidden redirect detector",
  "obfuscated javascript redirect tracer",
  "bot cloaking checker",
  "affiliate link tracker",
  "cloaked link unshortener",
  "link unshortener",
  "utm parameter tracker",
  "redirect loop detector",
  "canonical url checker",
  "http response headers viewer",
  "server redirect rule generator",
  "bulk redirect checker",
  "short link generator",
  "trace url hops",
  "seo redirect audit tool",
  "rca.crosx.in",
  "CROSX",
].join(", ");

export const LINKS_KEYWORDS = [
  "transparent short link generator",
  "custom url shortener",
  "302 redirect shortener",
  "qr code link generator",
  "smart redirect rules",
  "geo device url routing",
  "utm campaign builder",
  "bulk csv short links",
  "link click analytics",
  "destination health checker",
  "rca.crosx.in",
  "CROSX",
].join(", ");

export const API_DOCS_KEYWORDS = [
  "redirect trace api",
  "url unshortener json api",
  "redirect chain checker api",
  "server-side redirect tracer endpoint",
  "affiliate link audit api",
  "javascript redirect detection api",
  "seo redirect checker webhook",
  "rca.api.crosx.in",
  "rca.crosx.in",
  "CROSX",
].join(", ");

export interface PageSeoInput {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noindex?: boolean;
  keywords?: string;
  twitterCard?: "summary_large_image" | "summary";
}

export function canonicalUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanPath === "/" ? `${SITE_URL}/` : `${SITE_URL}${cleanPath.replace(/\/+$/, "")}`;
}

export function buildPageMeta(input: PageSeoInput) {
  const url = canonicalUrl(input.path);
  const robotsContent = input.noindex
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

  return [
    { title: input.title },
    { name: "description", content: input.description },
    { name: "keywords", content: input.keywords ?? CORE_KEYWORDS },
    { name: "author", content: BRAND_NAME },
    { name: "publisher", content: BRAND_NAME },
    { name: "robots", content: robotsContent },
    { name: "googlebot", content: robotsContent },
    { name: "bingbot", content: robotsContent },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { property: "og:image", content: DEFAULT_OG_IMAGE },
    { property: "og:image:secure_url", content: DEFAULT_OG_IMAGE },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "512" },
    { property: "og:image:height", content: "512" },
    { property: "og:image:alt", content: DEFAULT_OG_IMAGE_ALT },
    { name: "twitter:card", content: input.twitterCard ?? "summary_large_image" },
    { name: "twitter:domain", content: SITE_HOST },
    { name: "twitter:url", content: url },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: DEFAULT_OG_IMAGE },
    { name: "twitter:image:alt", content: DEFAULT_OG_IMAGE_ALT },
  ];
}

export function buildCanonicalLinks(path: string) {
  const url = canonicalUrl(path);
  return [
    { rel: "canonical", href: url },
    { rel: "alternate", hrefLang: "en", href: url },
    { rel: "alternate", hrefLang: "x-default", href: url },
  ];
}

export function buildHomeStructuredData(description: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: BRAND_NAME,
        legalName: "CROSX Advertising & Marketing Agency",
        url: SITE_URL,
        sameAs: [SITE_URL, "https://rca.api.crosx.in"],
        logo: {
          "@type": "ImageObject",
          url: CROSX_LOGO_URL,
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/?url={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: `${SITE_URL}/`,
        name: "Redirect & URL Trace Engine — Every Hop, HTTP or JavaScript",
        description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#webapp` },
        inLanguage: "en-US",
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", "h2", "#seo-guide-heading"],
        },
      },
      {
        "@type": ["WebApplication", "SoftwareApplication"],
        "@id": `${SITE_URL}/#webapp`,
        name: "Redirect Chain Analyzer",
        alternateName: "CROSX Redirect & URL Trace Engine",
        url: `${SITE_URL}/`,
        description,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "SEO & Network Forensics Tool",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
        publisher: { "@id": `${SITE_URL}/#organization` },
        featureList: [
          "Server-side HTTP 301, 302, 303, 307, and 308 redirect chain tracing up to 20 hops",
          "HTML meta http-equiv refresh and HTTP Refresh header redirect detection",
          "Sandboxed JavaScript VM de-obfuscation for Base64, Hex, ROT13, charCode, eval(), and window.location hops",
          "Headless Chromium fallback for script-gated and delayed client-side redirects",
          "Stateful per-hop Cookie Jar and embedded gateway parameter unwrapping",
          "Multi-Agent Bot Cloaking Matrix comparing Desktop Chrome, Mobile Safari, and Googlebot Smartphone",
          "Affiliate click_id, gclid, fbclid, msclkid, and UTM tracking parameter diffing with Clean URL generator",
          "SEO health scoring (0–100), canonical alignment, HSTS, X-Robots-Tag, and SERP/Social card preview",
          "One-click Server Redirect Rule Generator for Nginx, Apache .htaccess, Cloudflare, Vercel, and Netlify",
          "Bulk URL analysis up to 20 URLs per batch with CSV, JSON, Markdown, and plain-text export",
        ],
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${SITE_URL}/#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Redirect Chain Analyzer",
            item: `${SITE_URL}/`,
          },
        ],
      },
      {
        "@type": "HowTo",
        "@id": `${SITE_URL}/#howto`,
        name: "How to Trace a URL Redirect Chain and Audit SEO Signals",
        description:
          "Follow every HTTP, meta refresh, and JavaScript redirect hop to inspect status codes, headers, SEO canonicals, and tracking parameters.",
        totalTime: "PT15S",
        step: [
          {
            "@type": "HowToStep",
            position: 1,
            name: "Enter a URL or enable Bulk Mode",
            text: "Paste any single URL, short link, or affiliate tracking link—or switch to Bulk mode to queue up to 20 URLs at once.",
          },
          {
            "@type": "HowToStep",
            position: 2,
            name: "Select User-Agent Profile and Run Server-Side Trace",
            text: "Choose Desktop Chrome, Mobile Safari, or Googlebot Smartphone and click Analyze to trace HTTP 301/302/307/308 redirects, meta refresh tags, and obfuscated JavaScript hops.",
          },
          {
            "@type": "HowToStep",
            position: 3,
            name: "Inspect Hops, Forensics, Cloaking Matrix & Server Rules",
            text: "Review hop-by-hop latency, HTTP headers, decoded script payloads, canonical URLs, dropped UTM parameters, and copy auto-generated 301 consolidation rules or export to CSV/JSON.",
          },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "What is a redirect chain and why does it hurt SEO and conversions?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "A redirect chain occurs when a URL forwards through multiple intermediate hops (Hop A → Hop B → Hop C) before reaching the final landing page. Each extra hop adds DNS, TLS, and HTTP round-trip latency (hurting Core Web Vitals like LCP and TTFB), risks losing Googlebot crawl budget after 5–10 hops, and frequently strips UTM or affiliate click IDs when cross-domain redirects are misconfigured.",
            },
          },
          {
            "@type": "Question",
            name: "How does Redirect Chain Analyzer detect JavaScript and meta refresh redirects?",
            acceptedAnswer: {
              "@type": "Answer",
              text: 'Unlike basic HTTP header checkers that stop at status 200, our server-side trace engine inspects HTML responses for <meta http-equiv="refresh"> tags, canonical headers, and inline JavaScript navigation patterns (window.location, location.href, location.replace, location.assign), executing obfuscated scripts inside a sandboxed VM and escalating to a headless browser when cloaked client-side hops are detected.',
            },
          },
          {
            "@type": "Question",
            name: "Why should I test URLs with different User-Agent profiles (Googlebot vs Mobile vs Desktop)?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Many affiliate networks, geo-routers, and CDNs serve different redirect chains depending on the visitor's User-Agent. Switching between Desktop Chrome, iPhone iOS, Android Chrome, Googlebot Smartphone, and Social Preview bots exposes conditional redirects, mobile-only app-store traps, and SEO cloaking.",
            },
          },
          {
            "@type": "Question",
            name: "What is the SEO difference between 301, 302, 307, and 308 redirects?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "301 (Moved Permanently) and 308 (Permanent Redirect, preserving HTTP method) instruct search engines to transfer indexing signals and canonical authority permanently to the destination URL. 302 (Found) and 307 (Temporary Redirect) signal a temporary move, which can leave search engines indexing the old URL if left in place long-term.",
            },
          },
          {
            "@type": "Question",
            name: "How does the tracking parameter diff and Clean URL stripper work?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Every hop's query string is parsed and compared against the previous hop. We highlight added, modified, or dropped parameters (such as utm_source, gclid, fbclid, click_id, aff_id, subid) and automatically generate a clean, canonical destination URL with tracking noise stripped for one-click sharing.",
            },
          },
        ],
      },
    ],
  });
}

export function buildLinksStructuredData(description: string): string {
  const url = canonicalUrl("/links");
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: "Short Links — Redirect Chain Analyzer",
        description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        inLanguage: "en-US",
      },
      {
        "@type": ["WebApplication", "SoftwareApplication"],
        "@id": `${url}#webapp`,
        name: "CROSX Transparent Short Link Manager",
        url,
        description,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${SITE_URL}/#organization` },
        featureList: [
          "Custom slug 302 short links with SSRF destination validation",
          "Built-in UTM Campaign Builder for utm_source, utm_medium, utm_campaign, utm_term, and utm_content",
          "Downloadable SVG and PNG QR codes for every short link",
          "Conditional smart routing rules by Country, Device, OS, Browser, Query parameter, and UTC schedule",
          "Batch Destination Health Checker and Bulk CSV import/export",
        ],
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Redirect Chain Analyzer",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Short Links",
            item: url,
          },
        ],
      },
    ],
  });
}

export function buildApiDocsStructuredData(description: string): string {
  const url = canonicalUrl("/api-docs");
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: "Chain Tracer API — Add Redirect Tracing to Your Own Website",
        description,
        url,
        author: { "@type": "Organization", name: BRAND_NAME },
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: ["h1", "h2", "h3"],
        },
      },
      {
        "@type": "WebAPI",
        "@id": `${url}#webapi`,
        name: "CROSX Chain Tracer JSON API",
        description,
        documentation: url,
        termsOfService: `${SITE_URL}/api-docs`,
        provider: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Redirect Chain Analyzer",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Chain Tracer API",
            item: url,
          },
        ],
      },
    ],
  });
}

export function buildSharedReportStructuredData(description: string): string {
  const url = canonicalUrl("/r");
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Report",
        name: "Shared Redirect Chain Analysis Report",
        description,
        url,
        publisher: { "@type": "Organization", name: BRAND_NAME },
        inLanguage: "en-US",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Redirect Chain Analyzer",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Shared Redirect Report",
            item: url,
          },
        ],
      },
    ],
  });
}
