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
  resetSecurityStateForTests,
} from "./security.server";

test("WAF allows legitimate analyzer and API requests", () => {
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

test("WAF blocks vulnerability scanners, path traversal, dotfiles, SQLi/XSS, and disallowed HTTP verbs", () => {
  // 1. Disallowed HTTP method
  const deleteVerb = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", { method: "DELETE" }),
  );
  assert.equal(deleteVerb.ok, false);
  assert.equal(deleteVerb.status, 405);

  // 2. Scanner User-Agent
  const scannerReq = inspectIncomingRequest(
    new Request("https://rca.crosx.in/", {
      headers: { "user-agent": "sqlmap/1.8.4#stable (https://sqlmap.org)" },
    }),
  );
  assert.equal(scannerReq.ok, false);
  assert.equal(scannerReq.status, 403);

  // 3. Dotfile probe (/.env)
  const envProbe = inspectIncomingRequest(new Request("https://rca.crosx.in/.env"));
  assert.equal(envProbe.ok, false);
  assert.equal(envProbe.status, 403);

  // 4. Path traversal
  const traversal = inspectIncomingRequest(
    new Request("https://rca.crosx.in/assets/%2e%2e%2fetc/passwd"),
  );
  assert.equal(traversal.ok, false);
  assert.equal(traversal.status, 403);

  // 5. SQLi / XSS query payload
  const sqli = inspectIncomingRequest(
    new Request(
      "https://rca.crosx.in/links?q=%27%20UNION%20SELECT%20*%20FROM%20information_schema",
    ),
  );
  assert.equal(sqli.ok, false);
  assert.equal(sqli.status, 403);

  // 6. Oversized payload
  const oversized = inspectIncomingRequest(
    new Request("https://rca.crosx.in/api/public/trace", {
      method: "POST",
      headers: { "content-length": "500000" },
    }),
  );
  assert.equal(oversized.ok, false);
  assert.equal(oversized.status, 413);
});

test("Burst rate limiter throttles rapid floods and applies repeat-offender lockout", () => {
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

test("Security headers and constant-time comparison work deterministically", () => {
  assert.equal(constantTimeEquals("secret-token-123", "secret-token-123"), true);
  assert.equal(constantTimeEquals("secret-token-123", "secret-token-124"), false);
  assert.equal(constantTimeEquals("short", "longer-secret"), false);

  const res = applySecurityHeaders(new Response("ok", { status: 200 }), 12.34);
  assert.equal(res.headers.get("x-frame-options"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("strict-transport-security")?.includes("max-age=63072000"));
  assert.ok(res.headers.get("content-security-policy")?.includes("frame-ancestors 'self'"));
  assert.ok(res.headers.get("content-security-policy")?.includes("https://aistudio.google.com"));
  assert.equal(res.headers.get("server-timing"), "ssr;dur=12.3");
});
