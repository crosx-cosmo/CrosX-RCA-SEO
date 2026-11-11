/**
 * Interactive Visual Redirect Graph (SVG) & HTTP Archive (HAR v1.2) Exporter.
 */

import type { RedirectAnalysis } from "./redirect-types";

export interface HarLog {
  log: {
    version: "1.2";
    creator: {
      name: string;
      version: string;
    };
    pages: Array<{
      startedDateTime: string;
      id: string;
      title: string;
      pageTimings: {
        onContentLoad: number;
        onLoad: number;
      };
    }>;
    entries: Array<{
      pageref: string;
      startedDateTime: string;
      time: number;
      request: {
        method: string;
        url: string;
        httpVersion: string;
        cookies: Array<{ name: string; value: string }>;
        headers: Array<{ name: string; value: string }>;
        queryString: Array<{ name: string; value: string }>;
        headersSize: number;
        bodySize: number;
      };
      response: {
        status: number;
        statusText: string;
        httpVersion: string;
        cookies: Array<{ name: string; value: string }>;
        headers: Array<{ name: string; value: string }>;
        content: {
          size: number;
          mimeType: string;
        };
        redirectURL: string;
        headersSize: number;
        bodySize: number;
      };
      cache: Record<string, never>;
      timings: {
        blocked: number;
        dns: number;
        connect: number;
        send: number;
        wait: number;
        receive: number;
        ssl: number;
      };
      serverIPAddress?: string;
    }>;
  };
}

export function toHar(results: RedirectAnalysis[]): string {
  const pages: HarLog["log"]["pages"] = [];
  const entries: HarLog["log"]["entries"] = [];

  results.forEach((result, rIdx) => {
    const pageId = `page_${rIdx + 1}`;
    const baseTime = result.analyzedAt ? new Date(result.analyzedAt).getTime() : Date.now();
    const safeStartMs = Number.isNaN(baseTime) ? Date.now() : baseTime;

    pages.push({
      startedDateTime: new Date(safeStartMs).toISOString(),
      id: pageId,
      title: result.startUrl,
      pageTimings: {
        onContentLoad: result.totalResponseTimeMs,
        onLoad: result.totalResponseTimeMs,
      },
    });

    let elapsedOffset = 0;
    for (const hop of result.hops) {
      const hopStartIso = new Date(safeStartMs + elapsedOffset).toISOString();
      elapsedOffset += Math.max(0, hop.responseTimeMs);

      const queryString = Object.entries(hop.params ?? {}).map(([name, value]) => ({
        name,
        value,
      }));

      const respHeaders = Object.entries(hop.headers ?? {}).map(([name, value]) => ({
        name,
        value,
      }));

      const reqCookies = (hop.forensics?.cookiesSent ?? []).map((name) => ({
        name,
        value: "[forwarded]",
      }));

      const resCookies = (hop.forensics?.cookiesSet ?? []).map((c) => ({
        name: c.name,
        value: c.valuePreview,
      }));

      entries.push({
        pageref: pageId,
        startedDateTime: hopStartIso,
        time: hop.responseTimeMs,
        request: {
          method: "GET",
          url: hop.url,
          httpVersion: "HTTP/1.1",
          cookies: reqCookies,
          headers: [
            {
              name: "User-Agent",
              value: result.userAgentLabel ?? "Redirect Chain Analyzer (CROSX)",
            },
          ],
          queryString,
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: hop.status,
          statusText: hop.statusText,
          httpVersion: "HTTP/1.1",
          cookies: resCookies,
          headers: respHeaders,
          content: {
            size: 0,
            mimeType: hop.headers?.["content-type"] ?? "text/html",
          },
          redirectURL: hop.nextUrl ?? hop.location ?? "",
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: {
          blocked: 0,
          dns: -1,
          connect: -1,
          send: 1,
          wait: Math.max(0, hop.responseTimeMs - 2),
          receive: 1,
          ssl: hop.protocol === "https" ? 1 : -1,
        },
        ...(hop.ip ? { serverIPAddress: hop.ip } : {}),
      });
    }
  });

  const payload: HarLog = {
    log: {
      version: "1.2",
      creator: {
        name: "Redirect Chain Analyzer — CROSX (https://rca.crosx.in)",
        version: "2.0.0",
      },
      pages,
      entries,
    },
  };

  return JSON.stringify(payload, null, 2);
}

const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toFlowchartSvg(result: RedirectAnalysis): string {
  const hops = result.hops;
  const nodeHeight = 76;
  const gapY = 46;
  const width = 760;
  const totalHeight = Math.max(180, hops.length * (nodeHeight + gapY) + 40);

  const nodesSvg = hops
    .map((hop, idx) => {
      const y = 24 + idx * (nodeHeight + gapY);
      const isFinal = idx === hops.length - 1;
      const stroke =
        hop.status >= 400
          ? "#ef4444"
          : isFinal && hop.status >= 200 && hop.status < 300
            ? "#10b981"
            : "#f59e0b";

      const shortUrl = hop.url.length > 72 ? `${hop.url.slice(0, 69)}...` : hop.url;
      const badge = `${hop.status || "ERR"} · ${hop.mechanismLabel ?? hop.redirectType} · ${hop.responseTimeMs} ms`;

      const arrow =
        idx < hops.length - 1
          ? `<g>
              <line x1="${width / 2}" y1="${y + nodeHeight}" x2="${width / 2}" y2="${y + nodeHeight + gapY - 8}" stroke="#64748b" stroke-width="2" stroke-dasharray="4 3" />
              <polygon points="${width / 2 - 5},${y + nodeHeight + gapY - 10} ${width / 2 + 5},${y + nodeHeight + gapY - 10} ${width / 2},${y + nodeHeight + gapY}" fill="#64748b" />
            </g>`
          : "";

      return `<g>
        <rect x="30" y="${y}" width="${width - 60}" height="${nodeHeight}" rx="12" fill="#18181b" stroke="${stroke}" stroke-width="1.5" />
        <text x="50" y="${y + 28}" fill="#f8fafc" font-family="monospace" font-size="12" font-weight="600">Hop #${idx + 1} — ${escXml(badge)}</text>
        <text x="50" y="${y + 52}" fill="#94a3b8" font-family="monospace" font-size="11">${escXml(shortUrl)}</text>
      </g>${arrow}`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${width}" height="${totalHeight}">
  <rect width="100%" height="100%" fill="#09090b" rx="16" />
  ${nodesSvg}
</svg>`;
}
