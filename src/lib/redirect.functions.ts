import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import type { RedirectAnalysis, UserAgentPreset } from "./redirect-types";

const uaSchema = z
  .enum([
    "desktop-chrome",
    "mobile-iphone",
    "mobile-android",
    "googlebot-smartphone",
    "googlebot-desktop",
    "social-bot",
  ])
  .optional();

const inputSchema = z.object({
  url: z.string().trim().min(1, "URL is required").max(2048),
  userAgent: uaSchema,
});

function safeGetRequest(): Request | null {
  try {
    return getRequest();
  } catch {
    return null;
  }
}

/**
 * The trace engine is server-only (raw HTTP tracing, DNS checks, headless
 * browser fallback) and is loaded inside the handler so it never enters the
 * client bundle. Concurrent identical traces are coalesced via Singleflight.
 */
async function traceWithProtection(
  urls: string[],
  userAgent?: UserAgentPreset,
): Promise<RedirectAnalysis[]> {
  const [
    { traceUrl },
    {
      acquireConcurrencySlot,
      checkRateLimit,
      coalesceInFlight,
      extractClientFingerprint,
      extractClientIp,
    },
  ] = await Promise.all([import("./trace-engine.server"), import("./security.server")]);

  const req = safeGetRequest();
  const ip = extractClientIp(req);
  const fp = extractClientFingerprint(req);

  const limit = checkRateLimit(fp, "trace");
  if (!limit.ok) {
    throw new Error(limit.reason ?? "Rate limit exceeded. Please wait a moment and try again.");
  }

  const slot = acquireConcurrencySlot(ip, "trace");
  if (!slot.ok) {
    throw new Error(
      slot.reason ??
        "Too many simultaneous trace requests. Please wait for the active trace to finish.",
    );
  }

  try {
    const ua = userAgent ?? "desktop-chrome";
    const concurrency = 5;
    const results = new Array<RedirectAnalysis>(urls.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const url = urls[index]!;
        results[index] = await coalesceInFlight(`trace:${ua}:${url.trim()}`, () =>
          traceUrl(url, userAgent),
        );
      }
    });
    await Promise.all(workers);
    return results;
  } finally {
    slot.release();
  }
}

export const analyzeRedirectChain = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const [first] = await traceWithProtection([data.url], data.userAgent);
    return first!;
  });

export const analyzeRedirectChains = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(20),
        userAgent: uaSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => traceWithProtection(data.urls, data.userAgent));

export const compareRedirectAgents = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        url: z.string().trim().min(1).max(2048),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const [
      { traceUrl },
      {
        acquireConcurrencySlot,
        checkRateLimit,
        coalesceInFlight,
        extractClientFingerprint,
        extractClientIp,
      },
    ] = await Promise.all([import("./trace-engine.server"), import("./security.server")]);

    const req = safeGetRequest();
    const ip = extractClientIp(req);
    const fp = extractClientFingerprint(req);

    const limit = checkRateLimit(fp, "trace");
    if (!limit.ok) {
      throw new Error(limit.reason ?? "Rate limit exceeded. Please wait a moment and try again.");
    }

    const slot = acquireConcurrencySlot(ip, "trace");
    if (!slot.ok) {
      throw new Error(slot.reason ?? "Too many simultaneous trace requests.");
    }

    const profiles: UserAgentPreset[] = ["desktop-chrome", "mobile-iphone", "googlebot-smartphone"];

    try {
      const target = data.url.trim();
      return await Promise.all(
        profiles.map((ua) => coalesceInFlight(`trace:${ua}:${target}`, () => traceUrl(target, ua))),
      );
    } finally {
      slot.release();
    }
  });
