import test from "node:test";
import assert from "node:assert/strict";
import {
  buildApiDocsStructuredData,
  buildCanonicalLinks,
  buildHomeStructuredData,
  buildLinksStructuredData,
  buildPageMeta,
  buildSharedReportStructuredData,
  canonicalUrl,
  SITE_HOST,
  SITE_URL,
} from "./seo";
import {
  assemble,
  buildSeo,
  buildTrackingReport,
  countRedirects,
  isTrackingParam,
  normalizeUrl,
  stripTrackingParams,
  USER_AGENT_PRESETS,
} from "./redirect-analysis";
import { assertSafeUrl, classifyIp } from "./trace-ssrf.server";
import { evaluateRules, newRuleId, parseUserAgent } from "./link-rules";
import { validateDestination } from "./shortlinks.server";

test("SITE_URL defaults to official CROSX domain https://rca.crosx.in and canonicalUrl normalizes routes", async () => {
  assert.equal(SITE_URL, "https://rca.crosx.in");
  assert.equal(SITE_HOST, "rca.crosx.in");
  assert.equal(canonicalUrl("/"), "https://rca.crosx.in/");
  assert.equal(canonicalUrl("/links/"), "https://rca.crosx.in/links");
  assert.equal(canonicalUrl("api-docs"), "https://rca.crosx.in/api-docs");

  const selfShortLinkError = await validateDestination("https://rca.crosx.in/s/my-promo");
  assert.match(selfShortLinkError ?? "", /cannot point to another short link/);
});

test("buildPageMeta includes title, description, robots, OpenGraph and Twitter cards", () => {
  const meta = buildPageMeta({
    title: "Redirect & URL Trace Engine — Every Hop, HTTP or JavaScript",
    description:
      "Trace any URL end to end with full HTTP, meta refresh and JS redirect visibility.",
    path: "/",
  });

  const titleEntry = meta.find((m) => "title" in m);
  assert.equal(titleEntry?.title, "Redirect & URL Trace Engine — Every Hop, HTTP or JavaScript");

  const robotsEntry = meta.find((m) => "name" in m && m.name === "robots");
  assert.ok(robotsEntry && "content" in robotsEntry);
  assert.match(robotsEntry.content, /index, follow/);

  const ogUrl = meta.find((m) => "property" in m && m.property === "og:url");
  assert.equal(ogUrl?.content, `${SITE_URL}/`);

  const ogImage = meta.find((m) => "property" in m && m.property === "og:image");
  assert.equal(ogImage?.content, `${SITE_URL}/icons/icon-512.png`);
});

test("buildPageMeta respects noindex for shared reports", () => {
  const meta = buildPageMeta({
    title: "Shared Redirect Report",
    description: "Saved report",
    path: "/r/123",
    noindex: true,
  });
  const robotsEntry = meta.find((m) => "name" in m && m.name === "robots");
  assert.equal(robotsEntry?.content, "noindex, nofollow");
});

test("buildCanonicalLinks emits canonical and hreflang alternates", () => {
  const links = buildCanonicalLinks("/api-docs");
  assert.equal(links.length, 3);
  assert.deepEqual(links[0], { rel: "canonical", href: `${SITE_URL}/api-docs` });
});

test("Structured data builders return valid Schema.org JSON-LD @graph payloads with SearchAction and 5-question FAQPage", () => {
  const homeJson = JSON.parse(buildHomeStructuredData("Home description"));
  assert.equal(homeJson["@context"], "https://schema.org");
  assert.ok(Array.isArray(homeJson["@graph"]));

  const websiteNode = homeJson["@graph"].find(
    (node: { "@type": string }) => node["@type"] === "WebSite",
  );
  assert.equal(websiteNode?.potentialAction?.["@type"], "SearchAction");
  assert.equal(
    websiteNode?.potentialAction?.target?.urlTemplate,
    "https://rca.crosx.in/?url={search_term_string}",
  );

  const faqNode = homeJson["@graph"].find(
    (node: { "@type": string }) => node["@type"] === "FAQPage",
  );
  assert.ok(faqNode);
  assert.equal(faqNode.mainEntity.length, 5);

  const linksJson = JSON.parse(buildLinksStructuredData("Links description"));
  assert.ok(Array.isArray(linksJson["@graph"]));

  const apiJson = JSON.parse(buildApiDocsStructuredData("API description"));
  assert.ok(apiJson["@graph"].some((node: { "@type": string }) => node["@type"] === "WebAPI"));

  const sharedJson = JSON.parse(buildSharedReportStructuredData("Shared description"));
  assert.ok(sharedJson["@graph"].some((node: { "@type": string }) => node["@type"] === "Report"));
});

test("redirect-analysis normalizeUrl, stripTrackingParams, USER_AGENT_PRESETS and deep SEO signal extraction work accurately", () => {
  assert.equal(normalizeUrl("example.com/test"), "https://example.com/test");
  assert.equal(isTrackingParam("utm_source"), true);
  assert.equal(isTrackingParam("gclid"), true);
  assert.equal(isTrackingParam("page"), false);
  assert.equal(
    stripTrackingParams("https://example.com/landing?utm_source=news&gclid=123&page=2"),
    "https://example.com/landing?page=2",
  );
  assert.ok(USER_AGENT_PRESETS["googlebot-smartphone"].ua.includes("Googlebot"));

  const hops = [
    {
      index: 0,
      url: "http://example.com/?utm_source=news&aff_id=42",
      status: 301,
      statusText: "Moved Permanently",
      location: "https://example.com/landing?utm_source=news",
      resolvedLocation: "https://example.com/landing?utm_source=news",
      responseTimeMs: 110,
      headers: { location: "https://example.com/landing?utm_source=news" },
      protocol: "http" as const,
      params: { utm_source: "news", aff_id: "42" },
      redirectType: "Permanent Redirect",
      server: null,
      ip: null,
      mechanism: "http-redirect" as const,
    },
    {
      index: 1,
      url: "https://example.com/landing?utm_source=news",
      status: 200,
      statusText: "OK",
      location: null,
      resolvedLocation: null,
      responseTimeMs: 180,
      headers: {
        "content-type": "text/html",
        "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
        "x-robots-tag": "index, follow",
      },
      protocol: "https" as const,
      params: { utm_source: "news" },
      redirectType: "Success",
      server: null,
      ip: null,
      mechanism: "final-response" as const,
    },
  ];

  assert.equal(countRedirects(hops), 1);
  const tracking = buildTrackingReport(hops);
  assert.deepEqual(tracking.lostTrackingParams, ["aff_id"]);
  assert.deepEqual(tracking.keptTrackingParams, ["utm_source"]);

  const seo = buildSeo(hops, {
    canonical: "https://example.com/landing",
    metaRobots: "index, follow",
  });
  assert.equal(seo.https, true);
  assert.equal(seo.chainLength, 1);
  assert.equal(seo.canonicalStatus, "match");
  assert.equal(seo.cleanFinalUrl, "https://example.com/landing");
  assert.equal(seo.hsts, true);
  assert.equal(seo.xRobotsTag, "index, follow");

  const report = assemble({
    startUrl: hops[0]!.url,
    hops,
    redirectLoop: false,
    truncated: false,
    page: { canonical: "https://example.com/landing", metaRobots: "index, follow" },
    source: "demo",
    userAgentPreset: "googlebot-smartphone",
  });
  assert.equal(report.totalHops, 2);
  assert.equal(report.totalRedirects, 1);
  assert.equal(report.userAgentLabel, "Googlebot Smartphone");
});

test("classifyIp blocks private, loopback, expanded IPv6, NAT64, 6to4, and octal IPv4 while allowing public IPs", () => {
  // Public IPs allowed
  assert.equal(classifyIp("1.1.1.1"), null);
  assert.equal(classifyIp("8.8.8.8"), null);
  assert.equal(classifyIp("2606:4700:4700::1111"), null);

  // Blocked IPv4 ranges
  assert.equal(classifyIp("127.0.0.1"), "loopback");
  assert.equal(classifyIp("10.0.0.1"), "private network");
  assert.equal(classifyIp("169.254.169.254"), "link-local / cloud metadata range");
  assert.equal(classifyIp("010.0.0.1"), "malformed IPv4 address");

  // Blocked IPv6 bypass representations
  assert.equal(classifyIp("::1"), "loopback / unspecified address");
  assert.equal(classifyIp("0:0:0:0:0:0:0:1"), "loopback / unspecified address");
  assert.equal(classifyIp("0:0:0:0:0:0:0:0"), "loopback / unspecified address");
  assert.equal(classifyIp("::ffff:127.0.0.1"), "loopback");
  assert.equal(classifyIp("::ffff:7f00:0001"), "loopback");
  assert.equal(classifyIp("::192.168.1.1"), "private network");
  assert.equal(classifyIp("64:ff9b::10.0.0.1"), "private network");
  assert.equal(classifyIp("2002:7f00:0001::"), "loopback");
  assert.equal(classifyIp("2001:db8::1"), "documentation range");
  assert.equal(classifyIp("ff02::1"), "multicast address");
  assert.equal(classifyIp("fe80::1"), "link-local address");
  assert.equal(classifyIp("fc00::1"), "unique local address");
});

test("assertSafeUrl blocks embedded credentials and disallowed protocols/hosts", async () => {
  const credVerdict = await assertSafeUrl("https://admin:secret@example.com/path");
  assert.equal(credVerdict.ok, false);
  assert.match(credVerdict.reason ?? "", /embedded credentials/);

  const protoVerdict = await assertSafeUrl("file:///etc/passwd");
  assert.equal(protoVerdict.ok, false);

  const ipv6LoopbackVerdict = await assertSafeUrl("http://[0:0:0:0:0:0:0:1]/admin");
  assert.equal(ipv6LoopbackVerdict.ok, false);
});

test("newRuleId generates cryptographically random 10-character alphanumeric IDs and evaluateRules matches accurately", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const id = newRuleId();
    assert.match(id, /^[a-z0-9]{10}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 50);

  const parsedUa = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  assert.equal(parsedUa.os, "iOS");
  assert.equal(parsedUa.platform, "ios");

  const matched = evaluateRules(
    [
      {
        id: newRuleId(),
        name: "iOS US Promo",
        enabled: true,
        match: "all",
        conditions: [
          { field: "platform", op: "is", value: "ios" },
          { field: "country", op: "is", value: "US, CA" },
        ],
        destination: "https://example.com/ios-us",
      },
    ],
    {
      country: "US",
      platform: parsedUa.platform,
      browser: parsedUa.browser,
      os: parsedUa.os,
      query: {},
      now: new Date(),
    },
  );
  assert.equal(matched?.destination, "https://example.com/ios-us");
});

test("extractPageMeta extracts title, description, OpenGraph, Twitter card, canonical, robots, and hreflang count", async () => {
  const { extractPageMeta } = await import("./trace-detect");
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Spring Launch — Acme Cloud</title>
        <meta name="description" content="Explore the new Acme Cloud spring release." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="/pricing/spring" />
        <link rel="alternate" hreflang="en" href="https://acme.example.com/pricing/spring" />
        <link rel="alternate" hreflang="de" href="https://acme.example.com/de/pricing/spring" />
        <meta property="og:title" content="Acme Cloud Spring Launch" />
        <meta property="og:description" content="Enterprise cloud workflows." />
        <meta property="og:image" content="/assets/og-spring.png" />
        <meta name="twitter:card" content="summary_large_image" />
      </head>
      <body></body>
    </html>
  `;
  const meta = extractPageMeta(html, "https://acme.example.com/landing");
  assert.equal(meta.title, "Spring Launch — Acme Cloud");
  assert.equal(meta.description, "Explore the new Acme Cloud spring release.");
  assert.equal(meta.canonical, "https://acme.example.com/pricing/spring");
  assert.equal(meta.metaRobots, "index, follow");
  assert.equal(meta.ogTitle, "Acme Cloud Spring Launch");
  assert.equal(meta.ogDescription, "Enterprise cloud workflows.");
  assert.equal(meta.ogImage, "https://acme.example.com/assets/og-spring.png");
  assert.equal(meta.twitterCard, "summary_large_image");
  assert.equal(meta.hreflangCount, 2);
});

test("generateServerRedirectRules, evaluateCloakingMatrix, gradeSeoAnalysis, applyUtmParameters, and toSeoAuditCsv work accurately", async () => {
  const {
    applyUtmParameters,
    evaluateCloakingMatrix,
    generateBatchConsolidatedRules,
    generateServerRedirectRules,
    gradeSeoAnalysis,
  } = await import("./redirect-rules-codegen");
  const { toSeoAuditCsv } = await import("./redirect-export");
  const { buildDemoAnalysis } = await import("./redirect-demo");

  const demo = buildDemoAnalysis("https://promo.example.com/spring?utm_source=newsletter");
  const rules = generateServerRedirectRules(demo);
  assert.equal(rules.needsConsolidation, true);
  assert.equal(rules.hopsSaved, 2);
  assert.match(rules.snippets.nginx.code, /return 301 https:\/\/shop\.example\/landing/);
  assert.match(rules.snippets.apache.code, /RewriteRule/);
  assert.match(rules.snippets.cloudflare.code, /"status_code": 301/);
  assert.match(rules.snippets["cloudflare-worker"].code, /Response\.redirect\(target, 301\)/);
  assert.match(rules.snippets.wordpress.code, /add_action\('template_redirect'/);
  assert.match(rules.snippets.vercel.code, /"permanent": true/);
  assert.match(rules.snippets.netlify.code, /301!/);

  const batchHtaccess = generateBatchConsolidatedRules([demo], "apache");
  assert.match(batchHtaccess, /RewriteEngine On/);
  assert.match(batchHtaccess, /RewriteRule/);

  const grade = gradeSeoAnalysis(demo);
  assert.ok(grade.score >= 0 && grade.score <= 100);
  assert.ok(["Pass", "Warning", "Critical"].includes(grade.grade));

  const csv = toSeoAuditCsv([demo]);
  assert.match(csv, /"seo_grade","seo_score","start_url"/);
  assert.match(csv, /Spring Performance Collection/);

  const desktopReport = buildDemoAnalysis("https://example.com/offer");
  const mobileReport = {
    ...desktopReport,
    userAgentPreset: "mobile-iphone" as const,
    userAgentLabel: "Mobile Safari (iPhone iOS)",
  };
  const cloakedBotReport = {
    ...desktopReport,
    userAgentPreset: "googlebot-smartphone" as const,
    userAgentLabel: "Googlebot Smartphone",
    finalUrl: "https://example.com/seo-landing-page",
    seo: {
      ...desktopReport.seo,
      cleanFinalUrl: "https://example.com/seo-landing-page",
    },
  };

  const cloakedVerdict = evaluateCloakingMatrix([desktopReport, mobileReport, cloakedBotReport]);
  assert.equal(cloakedVerdict.cloakingDetected, true);
  assert.equal(cloakedVerdict.severity, "critical");

  const tagged = applyUtmParameters("https://rca.crosx.in/pricing?ref=nav", {
    source: "newsletter",
    medium: "email",
    campaign: "q4_launch",
  });
  assert.equal(
    tagged,
    "https://rca.crosx.in/pricing?ref=nav&utm_source=newsletter&utm_medium=email&utm_campaign=q4_launch",
  );
});

test("deep secret-link de-obfuscation: Base64, Hex, String.fromCharCode, reversed strings, variable indirection, auto-submit forms, and TraceCookieJar", async () => {
  const { detectClientRedirect, extractEmbeddedTargets } = await import("./trace-detect");
  const { TraceCookieJar } = await import("./trace-engine.server");

  // 1. Embedded targets: Base64, Double-URL-encoded, Hex, Proofpoint v3, Google AMP
  const b64Param = extractEmbeddedTargets(
    "https://l.facebook.com/l.php?u=aHR0cHM6Ly9yY2EuY3Jvc3guaW4vYXBpLWRvY3M=",
  );
  assert.equal(b64Param[0]?.url, "https://rca.crosx.in/api-docs");
  assert.equal(b64Param[0]?.encoding, "base64");

  const doubleEncoded = extractEmbeddedTargets(
    "https://tracker.example.com/out?redirect=https%253A%252F%252Frca.crosx.in%252Flinks",
  );
  assert.equal(doubleEncoded[0]?.url, "https://rca.crosx.in/links");
  assert.equal(doubleEncoded[0]?.encoding, "double-url-encoded");

  const hexEncoded = extractEmbeddedTargets(
    "https://gate.example.com/go?target=68747470733a2f2f7263612e63726f73782e696e2f",
  );
  assert.equal(hexEncoded[0]?.url, "https://rca.crosx.in/");
  assert.equal(hexEncoded[0]?.encoding, "hex");

  const proofpoint = extractEmbeddedTargets(
    "https://urldefense.com/v3/__https://rca.crosx.in/pricing__;!!AbcDef!12345",
  );
  assert.equal(proofpoint[0]?.url, "https://rca.crosx.in/pricing");

  // 2. Variable-indirected Base64 + setTimeout JS redirect
  const obfuscatedVarHtml = `
    <html><head><script>
      const secretDest = "aHR0cHM6Ly9yY2EuY3Jvc3guaW4vdmVyaWZpZWQ=";
      setTimeout(function() {
        window.location.replace(atob(secretDest));
      }, 1500);
    </script></head><body></body></html>
  `;
  const varDetection = detectClientRedirect(obfuscatedVarHtml, "https://cloak.example.com/");
  assert.equal(varDetection.signal?.rawTarget, "https://rca.crosx.in/verified");
  assert.equal(varDetection.signal?.delaySeconds, 1.5);
  assert.ok(varDetection.signal?.deobfuscationSteps?.length);

  // 3. Reversed string + String concatenation JS redirect
  const reversedHtml = `
    <html><head><script>
      location.href = "ni.xsorc.acr//:sptth".split("").reverse().join("");
    </script></head></html>
  `;
  const revDetection = detectClientRedirect(reversedHtml);
  assert.equal(revDetection.signal?.rawTarget, "https://rca.crosx.in");

  // 4. String.fromCharCode + Hex escape JS redirect
  const charCodeHtml = `
    <html><head><script>
      window.location.assign(\\x22https://rca.crosx.in/from-hex\\x22);
    </script></head></html>
  `;
  const hexJsDetection = detectClientRedirect(charCodeHtml);
  assert.equal(hexJsDetection.signal?.rawTarget, "https://rca.crosx.in/from-hex");

  // 5. Auto-submitted HTML <form action="..."> with hidden GET inputs
  const formHtml = `
    <html>
      <body onload="document.forms[0].submit()">
        <form action="https://rca.crosx.in/offer" method="GET">
          <input type="hidden" name="aff_id" value="9988" />
          <input type="hidden" name="token" value="xyz" />
        </form>
      </body>
    </html>
  `;
  const formDetection = detectClientRedirect(formHtml, "https://gate.example.com/start");
  assert.equal(formDetection.signal?.kind, "form-redirect");
  assert.equal(formDetection.signal?.rawTarget, "https://rca.crosx.in/offer?aff_id=9988&token=xyz");

  // 6. Stateful TraceCookieJar scoping
  const jar = new TraceCookieJar();
  const setInfo = jar.ingestSetCookieHeaders(
    [
      "aff_sid=tok_12345; Domain=.example.com; Path=/; Secure; HttpOnly; SameSite=Lax",
      "local_only=abc; Path=/private",
    ],
    "https://trk.example.com/click",
  );
  assert.equal(setInfo.length, 2);
  const forSubdomain = jar.getCookiesFor("https://shop.example.com/landing");
  assert.deepEqual(forSubdomain.names, ["aff_sid"]);
  assert.equal(forSubdomain.headerValue, "aff_sid=tok_12345");

  // 7. Hash fragment & ROT13 embedded targets
  const hashB64 = extractEmbeddedTargets(
    "https://cloak.example.com/go#aHR0cHM6Ly9yY2EuY3Jvc3guaW4vaGFzaC1zZWNyZXQ=",
  );
  assert.equal(hashB64[0]?.url, "https://rca.crosx.in/hash-secret");

  const rot13Param = extractEmbeddedTargets(
    "https://cloak.example.com/go?dest=uggcf://epn.pebfk.va/ebg13-zngpu",
  );
  assert.equal(rot13Param[0]?.url, "https://rca.crosx.in/rot13-match");

  // 8. Mock-DOM VM Sandbox: _0x array-indexed obfuscation
  const arrayObfuscatedHtml = `
    <html><head><script>
      var _0x99a = ["https://rca.crosx.in/vm-array-secret", "replace", "location"];
      window[_0x99a[2]][_0x99a[1]](_0x99a[0]);
    </script></head></html>
  `;
  const vmArrayRes = detectClientRedirect(arrayObfuscatedHtml, "https://cloak.example.com/");
  assert.equal(vmArrayRes.signal?.rawTarget, "https://rca.crosx.in/vm-array-secret");
  assert.match(vmArrayRes.signal?.method ?? "", /VM sandbox/);

  // 9. Mock-DOM VM Sandbox: dynamic window.location.hash Base64 reader + eval() packer + document.write()
  const hashReaderHtml = `
    <html><head><script>
      const rawHash = window.location.hash.slice(1);
      if (rawHash) {
        eval("window.location.href = atob('" + rawHash + "');");
      }
    </script></head></html>
  `;
  const vmHashRes = detectClientRedirect(
    hashReaderHtml,
    "https://cloak.example.com/gate#aHR0cHM6Ly9yY2EuY3Jvc3guaW4vZnJvbS1oYXNoLWV2YWw=",
  );
  assert.equal(vmHashRes.signal?.rawTarget, "https://rca.crosx.in/from-hash-eval");

  const docWriteHtml = `
    <html><head><script>
      document.write('<meta http-equiv="refresh" content="0;url=https://rca.crosx.in/from-doc-write">');
    </script></head></html>
  `;
  const docWriteRes = detectClientRedirect(docWriteHtml, "https://cloak.example.com/");
  assert.equal(docWriteRes.signal?.rawTarget, "https://rca.crosx.in/from-doc-write");

  // 10. Local headless Chromium fallback is configured and ready
  const { browserFallbackConfigured } = await import("./trace-browser.server");
  assert.equal(browserFallbackConfigured(), true);
});

test("enterprise suite: Threat Scanner, HAR/SVG Exporter, Sitemap/.htaccess/Nginx Migration Parser, Redirect Drift Monitor & A/B Split Rotator", async () => {
  const { scanRedirectThreats } = await import("./threat-scanner");
  const { toFlowchartSvg, toHar } = await import("./redirect-har");
  const { parseMigrationInput } = await import("./migration-parser");
  const { createBaselineFromAnalysis, evaluateRedirectDrift, formatWebhookPayload } =
    await import("./redirect-monitor");
  const { buildDemoAnalysis } = await import("./redirect-demo");

  // 1. Threat Scanner: clean vs phishing/homograph chain
  const demo = buildDemoAnalysis("https://promo.example.com/spring?utm_source=newsletter");
  const cleanScan = scanRedirectThreats(demo);
  assert.ok(cleanScan.trustScore > 0);
  assert.equal(cleanScan.securityHeaders.length, 5);

  const phishingChain = {
    ...demo,
    hops: [
      {
        ...demo.hops[0]!,
        url: "https://gate.example.com/out?redirect=https://xn--pypal-4ve.zip/login",
      },
      {
        ...demo.hops[demo.hops.length - 1]!,
        url: "http://secure-paypa1.zip:8443/verify",
        protocol: "http" as const,
        headers: {},
      },
    ],
  };
  const threatReport = scanRedirectThreats(phishingChain);
  assert.equal(threatReport.riskLevel, "critical-threat");
  assert.ok(threatReport.findings.some((f) => f.category === "brand-spoof"));
  assert.ok(threatReport.findings.some((f) => f.category === "suspicious-tld"));
  assert.ok(threatReport.findings.some((f) => f.category === "open-redirect"));
  assert.ok(threatReport.findings.some((f) => f.category === "protocol-downgrade"));

  // 2. HAR v1.2 & Flowchart SVG export
  const harJson = JSON.parse(toHar([demo]));
  assert.equal(harJson.log.version, "1.2");
  assert.equal(harJson.log.entries.length, demo.hops.length);
  const svg = toFlowchartSvg(demo);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /Hop #1/);

  // 3. Sitemap XML, Apache .htaccess & Nginx Migration Parser
  const xmlParsed = parseMigrationInput(
    `<urlset><url><loc>https://rca.crosx.in/</loc></url><url><loc>https://rca.crosx.in/links</loc></url></urlset>`,
  );
  assert.equal(xmlParsed.format, "sitemap-xml");
  assert.deepEqual(xmlParsed.urls, ["https://rca.crosx.in/", "https://rca.crosx.in/links"]);

  const htaccessParsed = parseMigrationInput(
    `Redirect 301 /old-blog https://rca.crosx.in/blog\nRewriteRule ^legacy-pricing/?$ https://rca.crosx.in/pricing [R=301,L]`,
    "https://rca.crosx.in",
  );
  assert.equal(htaccessParsed.format, "htaccess");
  assert.deepEqual(htaccessParsed.urls, [
    "https://rca.crosx.in/old-blog",
    "https://rca.crosx.in/legacy-pricing",
  ]);

  const nginxParsed = parseMigrationInput(
    `location = /v1/docs {\n  return 301 https://rca.crosx.in/api-docs;\n}\nrewrite ^/promo$ https://rca.crosx.in/links permanent;`,
    "https://rca.crosx.in",
  );
  assert.equal(nginxParsed.format, "nginx");
  assert.deepEqual(nginxParsed.urls, [
    "https://rca.crosx.in/v1/docs",
    "https://rca.crosx.in/promo",
  ]);

  // 4. Redirect Drift Monitor & Webhook Formatter
  const baseline = createBaselineFromAnalysis(demo, { intervalMinutes: 60 });
  const healthyCheck = evaluateRedirectDrift(baseline, demo);
  assert.equal(healthyCheck.status, "healthy");
  assert.equal(healthyCheck.anomalies.length, 0);

  const driftedLive = {
    ...demo,
    finalUrl: "https://hijacked.example/offer",
    totalRedirects: demo.totalRedirects + 2,
    finalStatus: 502,
    seo: {
      ...demo.seo,
      cleanFinalUrl: "https://hijacked.example/offer",
    },
    tracking: {
      ...demo.tracking,
      keptTrackingParams: [],
    },
  };
  const driftVerdict = evaluateRedirectDrift(baseline, driftedLive);
  assert.equal(driftVerdict.status, "drifted");
  assert.ok(driftVerdict.anomalies.some((a) => a.kind === "final_url_changed"));
  assert.ok(driftVerdict.anomalies.some((a) => a.kind === "hops_increased"));
  assert.ok(driftVerdict.anomalies.some((a) => a.kind === "status_degraded"));
  const webhookPayload = formatWebhookPayload(baseline, driftVerdict, driftedLive);
  assert.match(webhookPayload.text, /CROSX Redirect Monitor/);

  // 5. A/B Split-Testing Rotator in Short Link Rules
  const splitRules = [
    {
      id: newRuleId(),
      name: "Variant A",
      enabled: true,
      match: "all" as const,
      conditions: [{ field: "ab_split" as const, op: "between" as const, value: "0-49" }],
      destination: "https://rca.crosx.in/?variant=a",
    },
    {
      id: newRuleId(),
      name: "Variant B",
      enabled: true,
      match: "all" as const,
      conditions: [{ field: "ab_split" as const, op: "between" as const, value: "50-99" }],
      destination: "https://rca.crosx.in/?variant=b",
    },
  ];
  const hitA = evaluateRules(splitRules, {
    country: "US",
    platform: "desktop",
    browser: "Chrome",
    os: "macOS",
    query: {},
    now: new Date(),
    bucket: 12,
  });
  const hitB = evaluateRules(splitRules, {
    country: "US",
    platform: "desktop",
    browser: "Chrome",
    os: "macOS",
    query: {},
    now: new Date(),
    bucket: 78,
  });
  assert.equal(hitA?.destination, "https://rca.crosx.in/?variant=a");
  assert.equal(hitB?.destination, "https://rca.crosx.in/?variant=b");
});

test("universal hidden redirect detectors, clean browser Client Hints, JSON redirects, and upstream block reason extraction", async () => {
  const {
    detectClientRedirect,
    extractJsonRedirectTarget,
    extractUpstreamBlockReason,
    isOsOrDeviceRejectionMessage,
  } = await import("./trace-detect");
  const { buildHopRequestHeaders } = await import("./trace-engine.server");

  // 1. Clean browser UAs without bot fingerprint suffixes + matching Sec-CH-UA Client Hints
  assert.equal(USER_AGENT_PRESETS["desktop-chrome"].ua.includes("RedirectChainAnalyzer"), false);
  assert.equal(USER_AGENT_PRESETS["mobile-android"].ua.includes("RedirectChainAnalyzer"), false);
  assert.equal(USER_AGENT_PRESETS["mobile-iphone"].ua.includes("RedirectChainAnalyzer"), false);

  const androidHeaders = buildHopRequestHeaders(
    "mobile-android",
    "sid=abc",
    "https://ref.example.com/",
  );
  assert.equal(androidHeaders["sec-ch-ua-mobile"], "?1");
  assert.equal(androidHeaders["sec-ch-ua-platform"], '"Android"');
  assert.equal(androidHeaders["cookie"], "sid=abc");
  assert.equal(androidHeaders["referer"], "https://ref.example.com/");

  // 2. JSON API redirect & nested data payloads
  const flatJson = extractJsonRedirectTarget('{"ok":true,"url":"https://rca.crosx.in/json-hop"}');
  assert.equal(flatJson?.url, "https://rca.crosx.in/json-hop");
  assert.equal(flatJson?.keyPath, "url");

  const nestedJson = extractJsonRedirectTarget(
    '{"status":"success","data":{"result":{"redirectUrl":"https://rca.crosx.in/deep-json"}}}',
  );
  assert.equal(nestedJson?.url, "https://rca.crosx.in/deep-json");
  assert.equal(nestedJson?.keyPath, "data.result.redirectUrl");

  // 3. Upstream block reason extraction & OS-gate vs VPN/proxy classification
  const vpnMsg = extractUpstreamBlockReason(
    '{"status":"failed","message":"Access not allowed through a VPN or proxy"}',
  );
  assert.equal(vpnMsg, "Access not allowed through a VPN or proxy");
  assert.equal(isOsOrDeviceRejectionMessage(vpnMsg), false);

  const osMsg = extractUpstreamBlockReason(
    '{"status":"failed","message":"Access not allowed for your operating system"}',
  );
  assert.equal(osMsg, "Access not allowed for your operating system");
  assert.equal(isOsOrDeviceRejectionMessage(osMsg), true);

  // 4. ['h','t','t','p',...].join('') array de-obfuscation + template literal
  const arrayJoinHtml = `
    <html><head><script>
      const dest = ['h','t','t','p','s',':','/','/','rca.crosx.in','/arr'].join('');
      globalThis.location.replace(dest);
    </script></head></html>
  `;
  const arrRes = detectClientRedirect(arrayJoinHtml);
  assert.equal(arrRes.signal?.rawTarget, "https://rca.crosx.in/arr");

  // 5. Numeric decimal/hex HTML entities in meta refresh
  const entityRefresh = `
    <html><head>
      <meta http-equiv="refresh" content="0;url=&#104;&#116;&#116;&#112;s&#58;//rca.crosx.in/entity?a=1&amp;b=2" />
    </head></html>
  `;
  const entRes = detectClientRedirect(entityRefresh);
  assert.equal(entRes.signal?.rawTarget, "https://rca.crosx.in/entity?a=1&b=2");

  // 6. DOM getElementById('go').click() in VM sandbox + cloaked thin iframe forwarder
  const autoClickHtml = `
    <html><body>
      <a id="go-link" href="https://rca.crosx.in/auto-clicked">Continue</a>
      <script>document.getElementById('go-link').click();</script>
    </body></html>
  `;
  const clickRes = detectClientRedirect(autoClickHtml, "https://gate.example.com/");
  assert.equal(clickRes.signal?.rawTarget, "https://rca.crosx.in/auto-clicked");

  const cloakedIframeHtml = `
    <html><body style="margin:0">
      <iframe src="https://rca.crosx.in/cloaked-frame" style="width:100%;height:100vh"></iframe>
    </body></html>
  `;
  const iframeRes = detectClientRedirect(cloakedIframeHtml, "https://cloak.example.com/");
  assert.equal(iframeRes.signal?.rawTarget, "https://rca.crosx.in/cloaked-frame");

  // 7. <meta property="al:web:url"> AppLinks fallback
  const appLinksHtml = `
    <html><head>
      <meta property="al:web:url" content="https://rca.crosx.in/applink-fallback" />
    </head><body>Opening app...</body></html>
  `;
  const appRes = detectClientRedirect(appLinksHtml);
  assert.equal(appRes.signal?.rawTarget, "https://rca.crosx.in/applink-fallback");
});
