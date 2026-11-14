/**
 * Deep client-side redirect & secret-link de-obfuscation engine.
 *
 * Statically analyzes URLs and HTML documents (nothing is ever eval'd) to uncover:
 *  - HTML <meta http-equiv="refresh"> and HTTP Refresh headers
 *  - Direct and obfuscated JavaScript redirects:
 *      • location.href / replace() / assign() / window.open()
 *      • Variable indirection (const u = "..."; location.replace(u))
 *      • String literal concatenation ("https://" + "host" + "/path")
 *      • Hex (\xNN) and Unicode (\uNNNN) escape sequences
 *      • String.fromCharCode(...) sequences
 *      • Single and multi-layer Base64 atob(...) and Base64 variables
 *      • decodeURIComponent(...) / unescape(...) wrappers
 *      • Reversed string obfuscation ("...".split("").reverse().join(""))
 *      • setTimeout / setInterval delayed navigations
 *  - Auto-submitted HTML <form action="..."> redirects (with hidden input parameters)
 *  - Next.js / Nuxt / SPA JSON hydration redirects (__NEXT_DATA__)
 *  - Thin interstitial / link-locker skip & countdown targets
 *  - Nested query-parameter & gateway wrappers (Base64, Hex, double-URL-encoded,
 *    Proofpoint v3, SafeLinks, Facebook/Google/YouTube/AMP shims)
 */

import type { EmbeddedTargetInfo, HiddenPageArtifact } from "./redirect-types";

export type ClientRedirectKind = "meta-refresh" | "javascript-redirect" | "form-redirect";

export interface ClientRedirectSignal {
  kind: ClientRedirectKind;
  /** e.g. "location.replace()", "meta refresh (0s)", "obfuscated JS (Base64 + variable)" */
  method: string;
  /** Raw source fragment the destination was taken from. */
  evidence: string;
  /** Destination as extracted/decoded from the document (may be relative). */
  rawTarget: string;
  delaySeconds: number | null;
  /** Step-by-step forensic trail of how obfuscation was unwrapped. */
  deobfuscationSteps?: string[];
}

/** Signal that a page looks like it navigates but no static URL could be read. */
export interface DynamicRedirectHint {
  method: string;
  evidence: string;
}

function clean(value: string): string {
  return value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d{1,7});/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/");
}

function snippet(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function safeResolveUrl(raw: string | null, baseUrl?: string): string | null {
  if (!raw) return null;
  if (!baseUrl) return raw;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function isPlausibleHttpUrl(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!/^https?:\/\/[^\s"'<>`\\]{4,}/i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function tryDecodeBase64Url(encoded: string): string | null {
  const cleaned = encoded.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (cleaned.length < 12 || cleaned.length > 4096) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
  try {
    const decoded = atob(padded).trim();
    // Handle double-base64 encoding
    if (/^(?:aHR0cHM6Ly|aHR0cDovL)[A-Za-z0-9+/=_-]+$/.test(decoded)) {
      try {
        const inner = atob(decoded.replace(/-/g, "+").replace(/_/g, "/")).trim();
        if (isPlausibleHttpUrl(inner)) return inner;
      } catch {
        // keep first layer
      }
    }
    if (isPlausibleHttpUrl(decoded)) return decoded;
    // Sometimes base64 wraps a URL-encoded string
    if (/^https?%3A%2F%2F/i.test(decoded)) {
      const unescaped = decodeURIComponent(decoded);
      if (isPlausibleHttpUrl(unescaped)) return unescaped;
    }
  } catch {
    return null;
  }
  return null;
}

function tryDecodeHexUrl(hexStr: string): string | null {
  const cleaned = hexStr.trim().replace(/^0x/i, "");
  if (cleaned.length < 16 || cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
    return null;
  }
  try {
    let out = "";
    for (let i = 0; i < cleaned.length; i += 2) {
      out += String.fromCharCode(parseInt(cleaned.slice(i, i + 2), 16));
    }
    return isPlausibleHttpUrl(out) ? out.trim() : null;
  } catch {
    return null;
  }
}

const REDIRECT_PARAM_KEYS = new Set([
  "url",
  "u",
  "q",
  "redirect",
  "redirect_uri",
  "redirect_url",
  "redirecturl",
  "redir",
  "dest",
  "dest_url",
  "destination",
  "target",
  "target_url",
  "to",
  "out",
  "out_url",
  "goto",
  "go_to",
  "forward",
  "link",
  "r",
  "next",
  "continue",
  "return",
  "returnto",
  "return_url",
  "fallback",
  "fallback_url",
  "$fallback_url",
  "$desktop_url",
  "$canonical_url",
  "af_web_dp",
  "deep_link_value",
  "lp",
  "offer_url",
  "deep_link",
  "uri",
  "href",
  "url_to",
]);

/**
 * Inspects a URL for nested/wrapped destination URLs hidden in query parameters
 * (raw, URL-encoded, double-URL-encoded, Base64, or Hex) or gateway path segments
 * (Proofpoint URL Defense, Google AMP, etc.).
 */
export function extractEmbeddedTargets(rawUrl: string): EmbeddedTargetInfo[] {
  const results: EmbeddedTargetInfo[] = [];
  const seen = new Set<string>();

  const pushUnique = (info: EmbeddedTargetInfo) => {
    if (!seen.has(info.url) && info.url !== rawUrl) {
      seen.add(info.url);
      results.push(info);
    }
  };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return results;
  }

  // 1. Proofpoint URL Defense v3: /v3/__https://example.com/path__;!!...
  const proofpointMatch = parsed.pathname.match(/\/v3\/__(https?:\/\/[^_]+)__/i);
  if (proofpointMatch?.[1]) {
    const raw = proofpointMatch[1].replace(/\*([0-9a-fA-F]{2})/g, "%$1");
    try {
      const decoded = decodeURIComponent(raw);
      if (isPlausibleHttpUrl(decoded)) {
        pushUnique({
          source: "Proofpoint v3 path wrapper",
          url: decoded,
          encoding: "gateway-path",
        });
      }
    } catch {
      if (isPlausibleHttpUrl(raw)) {
        pushUnique({
          source: "Proofpoint v3 path wrapper",
          url: raw,
          encoding: "gateway-path",
        });
      }
    }
  }

  // 2. Google AMP cache path: /amp/s/example.com/path
  const ampMatch = parsed.pathname.match(/^\/amp\/s\/([^\s?#]+)/i);
  if (ampMatch?.[1] && /google\./i.test(parsed.hostname)) {
    const candidate = `https://${ampMatch[1]}${parsed.search}`;
    if (isPlausibleHttpUrl(candidate)) {
      pushUnique({
        source: "Google AMP path wrapper",
        url: candidate,
        encoding: "gateway-path",
      });
    }
  }

  // 3. Query parameters (prioritize known redirect keys, then check remaining keys)
  const entries = Array.from(parsed.searchParams.entries()).sort(([a], [b]) => {
    const aKnown = REDIRECT_PARAM_KEYS.has(a.toLowerCase()) ? 0 : 1;
    const bKnown = REDIRECT_PARAM_KEYS.has(b.toLowerCase()) ? 0 : 1;
    return aKnown - bKnown;
  });

  for (const [key, rawVal] of entries) {
    const val = rawVal.trim();
    if (!val || val.length < 8) continue;

    // 3a. Direct http(s):// value (already decoded once by URLSearchParams)
    if (isPlausibleHttpUrl(val)) {
      const wasEncodedInRaw = new RegExp(`[?&]${key}=https?%3A`, "i").test(parsed.search);
      pushUnique({
        source: `Query param "${key}"`,
        url: val,
        encoding: wasEncodedInRaw ? "url-encoded" : "raw",
      });
      continue;
    }

    // 3b. Double URL-encoded value (e.g. https%3A%2F%2F...)
    if (/^https?%3A%2F%2F/i.test(val) || /%253A%252F%252F/i.test(val)) {
      try {
        let dec = decodeURIComponent(val);
        if (/^https?%3A%2F%2F/i.test(dec)) dec = decodeURIComponent(dec);
        if (isPlausibleHttpUrl(dec)) {
          pushUnique({
            source: `Query param "${key}" (double URL-encoded)`,
            url: dec,
            encoding: "double-url-encoded",
          });
          continue;
        }
      } catch {
        // ignore
      }
    }

    // 3c. Base64 / Base64URL encoded URL in query param
    const b64 = tryDecodeBase64Url(val);
    if (b64) {
      pushUnique({
        source: `Query param "${key}" (Base64)`,
        url: b64,
        encoding: "base64",
      });
      continue;
    }

    // 3d. Hex encoded URL in query param
    const hex = tryDecodeHexUrl(val);
    if (hex) {
      pushUnique({
        source: `Query param "${key}" (Hex)`,
        url: hex,
        encoding: "hex",
      });
      continue;
    }

    // 3e. ROT13 encoded URL in query param (uggcf://... or uggc://...)
    if (/^uggcf?:\/\//i.test(val)) {
      const rot = val.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      });
      if (isPlausibleHttpUrl(rot)) {
        pushUnique({
          source: `Query param "${key}" (ROT13)`,
          url: rot,
          encoding: "raw",
        });
      }
    }
  }

  // 4. URL Hash / Fragment (#https://..., #url=..., #aHR0cHM6..., #68747470...)
  const rawHash = parsed.hash.replace(/^#+/, "").trim();
  if (rawHash.length >= 8) {
    if (isPlausibleHttpUrl(rawHash)) {
      pushUnique({
        source: "URL #hash fragment",
        url: rawHash,
        encoding: "raw",
      });
    } else if (/^https?%3A%2F%2F/i.test(rawHash)) {
      try {
        const dec = decodeURIComponent(rawHash);
        if (isPlausibleHttpUrl(dec)) {
          pushUnique({
            source: "URL #hash fragment (URL-encoded)",
            url: dec,
            encoding: "url-encoded",
          });
        }
      } catch {
        // ignore
      }
    } else {
      const hashB64 = tryDecodeBase64Url(rawHash);
      if (hashB64) {
        pushUnique({
          source: "URL #hash fragment (Base64)",
          url: hashB64,
          encoding: "base64",
        });
      } else {
        const hashHex = tryDecodeHexUrl(rawHash);
        if (hashHex) {
          pushUnique({
            source: "URL #hash fragment (Hex)",
            url: hashHex,
            encoding: "hex",
          });
        } else if (rawHash.includes("=")) {
          try {
            const hashParams = new URLSearchParams(rawHash.replace(/^[/?]+/, ""));
            for (const [hk, hv] of hashParams.entries()) {
              const v = hv.trim();
              if (isPlausibleHttpUrl(v)) {
                pushUnique({ source: `Hash param "#${hk}"`, url: v, encoding: "raw" });
              } else {
                const hb = tryDecodeBase64Url(v);
                if (hb)
                  pushUnique({
                    source: `Hash param "#${hk}" (Base64)`,
                    url: hb,
                    encoding: "base64",
                  });
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return results;
}

export function parseRefreshValue(content: string): { url: string; delay: number } | null {
  const match = content.match(/^\s*([\d.]+)?\s*;?\s*url\s*=\s*(.+)$/i);
  if (match?.[2]) {
    return { url: decodeEntities(clean(match[2])), delay: Number(match[1] ?? 0) || 0 };
  }
  // "Refresh: 0; https://example.com" (no url= key)
  const loose = content.match(/^\s*([\d.]+)\s*;\s*(\S+)\s*$/);
  if (loose?.[2]) return { url: decodeEntities(clean(loose[2])), delay: Number(loose[1]) || 0 };
  return null;
}

/**
 * Statically de-obfuscates common JavaScript string hiding techniques inside script blocks
 * without executing any untrusted code.
 */
export function deobfuscateJsSource(rawJs: string): {
  normalizedJs: string;
  steps: string[];
  variables: Map<string, string>;
} {
  let js = rawJs;
  const steps: string[] = [];

  // 1. Decode \xNN hex escapes inside string literals
  if (/\\x[0-9a-fA-F]{2}/.test(js)) {
    js = js.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    steps.push("Decoded hex escape sequences (\\xNN)");
  }

  // 2. Decode \uNNNN unicode escapes
  if (/\\u[0-9a-fA-F]{4}/.test(js)) {
    js = js.replace(/\\u([0-9a-fA-F]{4})/g, (_, uni: string) =>
      String.fromCharCode(parseInt(uni, 16)),
    );
    steps.push("Decoded Unicode escape sequences (\\uNNNN)");
  }

  // 3. Evaluate String.fromCharCode(104, 116, 116, 112, ...)
  if (/String\.fromCharCode\s*\(/i.test(js)) {
    js = js.replace(
      /String\.fromCharCode\s*\(\s*([\d\s,xXa-fA-F]+)\s*\)/g,
      (full, nums: string) => {
        const parts = nums
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 0 || parts.length > 2048) return full;
        const chars = parts.map((p) =>
          p.startsWith("0x") || p.startsWith("0X") ? parseInt(p, 16) : parseInt(p, 10),
        );
        if (chars.some((n) => Number.isNaN(n) || n < 9 || n > 126)) return full;
        steps.push("Evaluated String.fromCharCode() payload");
        return JSON.stringify(String.fromCharCode(...chars));
      },
    );
  }

  // 4. Evaluate reversed string literals: "ni.xsorc.acr//:sptth".split("").reverse().join("")
  if (/\.split\s*\(\s*["']{2}\s*\)\s*\.reverse\s*\(\s*\)\s*\.join\s*\(\s*["']{2}\s*\)/.test(js)) {
    js = js.replace(
      /(["'`])([^"'`]{8,512})\1\s*\.split\s*\(\s*["']{2}\s*\)\s*\.reverse\s*\(\s*\)\s*\.join\s*\(\s*["']{2}\s*\)/g,
      (_, _q: string, body: string) => {
        const rev = body.split("").reverse().join("");
        steps.push("Unreversed .split('').reverse().join('') string");
        return JSON.stringify(rev);
      },
    );
  }

  // 4b. Evaluate character/chunk array joins: ['h','t','t','p','s',':','/','/',...].join('')
  if (/\]\s*\.join\s*\(\s*["']{0,2}\s*\)/.test(js)) {
    js = js.replace(
      /\[\s*((?:["'][^"'\\]{0,256}["']\s*,\s*)*["'][^"'\\]{0,256}["'])\s*\]\s*\.join\s*\(\s*["']{2}\s*\)/g,
      (full, itemsRaw: string) => {
        const items: string[] = [];
        const itemRe = /(["'])([^"'\\]{0,256})\1/g;
        let im: RegExpExecArray | null;
        while ((im = itemRe.exec(itemsRaw))) {
          items.push(im[2] ?? "");
        }
        if (items.length === 0) return full;
        steps.push("Collapsed ['...'].join('') character/chunk array");
        return JSON.stringify(items.join(""));
      },
    );
  }

  // 4c. Convert expressionless template literals `https://example.com` into regular strings
  if (/`[^`$\\]{6,2048}`/.test(js)) {
    js = js.replace(/`([^`$\\]{6,2048})`/g, (_, inner: string) => JSON.stringify(inner));
  }

  // 5. Collapse adjacent string concatenations: "https://" + "example.com" + "/path"
  let concatPass = 0;
  const concatRe = /(["'])([^"'\\]{1,500})\1\s*\+\s*(["'])([^"'\\]{1,500})\3/g;
  while (concatPass < 6 && concatRe.test(js)) {
    js = js.replace(concatRe, (_, _q1: string, a: string, _q2: string, b: string) =>
      JSON.stringify(a + b),
    );
    concatPass++;
  }
  if (concatPass > 0) {
    steps.push("Collapsed concatenated JS string literals");
  }

  // 6. Unwrap decodeURIComponent("...") / unescape("...")
  if (/(?:decodeURIComponent|unescape)\s*\(\s*["'`]/.test(js)) {
    js = js.replace(
      /(?:decodeURIComponent|unescape)\s*\(\s*(["'`])([^"'`]{6,2048})\1\s*\)/g,
      (full, _q: string, inner: string) => {
        try {
          const decoded = decodeURIComponent(inner);
          steps.push("Decoded decodeURIComponent()/unescape() wrapper");
          return JSON.stringify(decoded);
        } catch {
          return full;
        }
      },
    );
  }

  // 7. Unwrap nested and single atob("...") calls
  let atobPass = 0;
  const atobRe = /atob\s*\(\s*(["'`])([A-Za-z0-9+/=_-]{8,4096})\1\s*\)/g;
  while (atobPass < 3 && atobRe.test(js)) {
    let changed = false;
    js = js.replace(atobRe, (full, _q: string, b64: string) => {
      try {
        const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
        const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
        const decoded = atob(padded).trim();
        if (/^[\x20-\x7E]+$/.test(decoded)) {
          changed = true;
          return JSON.stringify(decoded);
        }
      } catch {
        // ignore invalid base64
      }
      return full;
    });
    if (!changed) break;
    atobPass++;
  }
  if (atobPass > 0) {
    steps.push(
      atobPass > 1
        ? `Decoded ${atobPass}-layer nested Base64 atob() payload`
        : "Decoded Base64 atob() payload",
    );
  }

  // 8. Build symbol table of static string variables: const/let/var foo = "..."
  const variables = new Map<string, string>();
  const varRe =
    /(?:(?:var|let|const)\s+|window\.)([A-Za-z_$][\w$]{0,60})\s*=\s*(["'`])([^"'`\n]{1,2048})\2/g;
  let vm: RegExpExecArray | null;
  while ((vm = varRe.exec(js))) {
    const varName = vm[1]!;
    const rawVal = vm[3]!.trim();
    const b64Candidate = tryDecodeBase64Url(rawVal);
    variables.set(varName, b64Candidate ?? rawVal);
  }

  // Also resolve `atob(varName)` where varName was a base64 string
  if (variables.size > 0 && /atob\s*\(\s*[A-Za-z_$]/.test(js)) {
    js = js.replace(/atob\s*\(\s*([A-Za-z_$][\w$]{0,60})\s*\)/g, (full, ident: string) => {
      const resolved = variables.get(ident);
      if (resolved && isPlausibleHttpUrl(resolved)) {
        steps.push(`Resolved Base64 variable "${ident}" passed to atob()`);
        return JSON.stringify(resolved);
      }
      return full;
    });
  }

  return {
    normalizedJs: js,
    steps: Array.from(new Set(steps)),
    variables,
  };
}

const JS_PATTERNS: Array<{ re: RegExp; method: string }> = [
  {
    re: /(?:window|document|top|self|parent|globalThis)?\.?location\s*\.\s*replace\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location.replace()",
  },
  {
    re: /(?:window|document|top|self|parent|globalThis)?\.?location\s*\.\s*assign\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location.assign()",
  },
  {
    re: /(?:window|document|top|self|parent|globalThis)\s*\.\s*location\s*\.\s*href\s*=\s*(["'`])([^"'`]+)\1/i,
    method: "window.location.href",
  },
  {
    re: /(?:window|document|top|self|parent|globalThis)\s*\.\s*location\s*=\s*(["'`])([^"'`]+)\1/i,
    method: "window.location",
  },
  { re: /\blocation\s*\.\s*href\s*=\s*(["'`])([^"'`]+)\1/i, method: "location.href" },
  { re: /\bdocument\s*\.\s*location\s*=\s*(["'`])([^"'`]+)\1/i, method: "document.location" },
  {
    re: /\blocation\s*\.\s*(?:assign|replace)\s*\(\s*(["'`])([^"'`]+)\1/i,
    method: "location navigation",
  },
  {
    re: /(?:window|document|top|self|globalThis)?\.?location\s*\[\s*["'`](?:href|replace|assign)["'`]\s*\]\s*(?:=\s*(["'`])([^"'`]+)\1|\(\s*(["'`])([^"'`]+)\3\s*\))/i,
    method: "bracket-notation location[...]",
  },
  { re: /\bwindow\s*\.\s*open\s*\(\s*(["'`])(https?:\/\/[^"'`]+)\1/i, method: "window.open()" },
];

const JS_VAR_PATTERNS: Array<{ re: RegExp; method: string }> = [
  {
    re: /(?:window|document|top|self|parent|globalThis)?\.?location\s*\.\s*(?:replace|assign)\s*\(\s*([A-Za-z_$][\w$]{0,60})\s*\)/i,
    method: "location.replace(variable)",
  },
  {
    re: /(?:(?:window|document|top|self|parent|globalThis)\s*\.\s*)?location(?:\s*\.\s*href)?\s*=\s*([A-Za-z_$][\w$]{0,60})\s*(?:[;,\n)}]|$)/i,
    method: "location.href = variable",
  },
];

const DYNAMIC_HINTS: Array<{ re: RegExp; method: string }> = [
  {
    re: /location\s*\.\s*(?:replace|assign)\s*\(\s*[A-Za-z_$]/,
    method: "location.replace()/assign() with a computed value",
  },
  {
    re: /location(?:\s*\.\s*href)?\s*=\s*[A-Za-z_$][\w$.[\]]*\s*[;\n]/,
    method: "location assignment from a variable",
  },
  {
    re: /history\s*\.\s*(?:pushState|replaceState)\s*\(/,
    method: "history.pushState()/replaceState()",
  },
  { re: /\.submit\s*\(\s*\)/, method: "auto-submitted form" },
];

function extractTimerDelaySeconds(js: string): number | null {
  const m = js.match(/setTimeout\s*\([\s\S]{0,240}?,\s*(\d{2,6})\s*\)/i);
  if (!m?.[1]) return null;
  const ms = Number(m[1]);
  return Number.isFinite(ms) && ms >= 0 ? Math.round((ms / 1000) * 10) / 10 : null;
}

/**
 * Extracts auto-submitted HTML <form action="..."> redirects and merges hidden
 * input fields for GET forms.
 */
function detectAutoSubmitFormRedirect(
  html: string,
  jsBlob: string,
  baseUrl?: string,
): ClientRedirectSignal | null {
  const hasAutoSubmit =
    /\.(?:submit|requestSubmit)\s*\(\s*\)/i.test(jsBlob) ||
    /onload\s*=\s*["'][^"']*\.(?:submit|requestSubmit)\s*\(/i.test(html);
  if (!hasAutoSubmit) return null;

  const formMatch = html.match(/<form\b([^>]*)>([\s\S]{0,20000}?)<\/form>/i);
  if (!formMatch) return null;

  const attrs = formMatch[1] ?? "";
  const body = formMatch[2] ?? "";
  const action = attrs.match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (!action || /^javascript:/i.test(action)) return null;

  const method = (attrs.match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] ?? "GET")
    .trim()
    .toUpperCase();

  let targetUrl = decodeEntities(action);
  const steps: string[] = [`Detected auto-submitted <form method="${method}">`];

  // Collect hidden input parameters when method is GET (or to enrich query destination)
  const inputRe = /<input\b[^>]*>/gi;
  const hiddenParams: Array<[string, string]> = [];
  let im: RegExpExecArray | null;
  while ((im = inputRe.exec(body))) {
    const tag = im[0];
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const val = tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (name) hiddenParams.push([decodeEntities(name), decodeEntities(val)]);
  }

  if (method === "GET" && hiddenParams.length > 0) {
    try {
      const resolved = new URL(targetUrl, baseUrl ?? "https://placeholder.local");
      for (const [k, v] of hiddenParams) {
        if (!resolved.searchParams.has(k)) resolved.searchParams.set(k, v);
      }
      targetUrl = baseUrl
        ? resolved.toString()
        : targetUrl.startsWith("http")
          ? resolved.toString()
          : `${resolved.pathname}${resolved.search}`;
      steps.push(`Appended ${hiddenParams.length} hidden form input parameter(s)`);
    } catch {
      // keep raw action
    }
  } else if (hiddenParams.length > 0) {
    // Check if any hidden input itself contains a nested redirect target URL
    for (const [k, v] of hiddenParams) {
      if (REDIRECT_PARAM_KEYS.has(k.toLowerCase()) && isPlausibleHttpUrl(v)) {
        steps.push(`Extracted nested destination from hidden input "${k}"`);
        targetUrl = v;
        break;
      }
    }
  }

  return {
    kind: "form-redirect",
    method: `auto-submitted <form method="${method}">`,
    evidence: snippet(formMatch[0]),
    rawTarget: targetUrl,
    delaySeconds: null,
    deobfuscationSteps: steps,
  };
}

/**
 * Inspects Next.js / Nuxt / SPA hydration JSON or thin interstitial countdown pages
 * for explicit redirect destinations.
 */
function detectHydrationOrInterstitialRedirect(html: string): ClientRedirectSignal | null {
  // 1. Next.js __NEXT_DATA__ or inline JSON redirect object
  const nextDataMatch = html.match(
    /<script[^>]+id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]{1,100000}?)<\/script>/i,
  );
  if (nextDataMatch?.[1]) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]) as Record<string, unknown>;
      const jsonStr = JSON.stringify(parsed);
      const destMatch = jsonStr.match(
        /"(?:destination|redirectUrl|redirect_url|targetUrl|target_url)"\s*:\s*"(https?:\/\/[^"]+)"/i,
      );
      if (destMatch?.[1] && isPlausibleHttpUrl(destMatch[1])) {
        return {
          kind: "javascript-redirect",
          method: "Next.js hydration redirect (__NEXT_DATA__)",
          evidence: snippet(destMatch[0]),
          rawTarget: destMatch[1],
          delaySeconds: null,
          deobfuscationSteps: ["Extracted redirect destination from __NEXT_DATA__ hydration state"],
        };
      }
    } catch {
      // ignore malformed JSON
    }
  }

  // 2. Data attribute redirector on body/main container (e.g. data-redirect-url="https://...")
  const dataRedirectMatch = html.match(
    /\bdata-(?:redirect(?:-url)?|target-url|destination| final-url)\s*=\s*["'](https?:\/\/[^"']+)["']/i,
  );
  if (dataRedirectMatch?.[1] && isPlausibleHttpUrl(dataRedirectMatch[1])) {
    return {
      kind: "javascript-redirect",
      method: "HTML data-redirect attribute",
      evidence: snippet(dataRedirectMatch[0]),
      rawTarget: decodeEntities(dataRedirectMatch[1]),
      delaySeconds: null,
      deobfuscationSteps: ["Extracted target URL from HTML data-redirect attribute"],
    };
  }

  // 2b. <meta name="redirect" content="..."> or AppLinks <meta property="al:web:url" content="...">
  const customMetaRedirect =
    matchMetaContent(html, "name", "redirect") ??
    matchMetaContent(html, "property", "al:web:url") ??
    matchMetaContent(html, "property", "al:web:fallback");
  if (customMetaRedirect && isPlausibleHttpUrl(customMetaRedirect)) {
    return {
      kind: "meta-refresh",
      method: "HTML meta redirect / AppLinks target",
      evidence: customMetaRedirect,
      rawTarget: customMetaRedirect,
      delaySeconds: 0,
      deobfuscationSteps: ["Extracted URL from <meta name='redirect'> / AppLinks fallback tag"],
    };
  }

  // 3. Thin interstitial / link-locker page with an explicit "skip / continue / redirect" link
  if (looksLikeRedirector(html)) {
    const anchorRe = /<a\b([^>]+)>([\s\S]{0,300}?)<\/a>/gi;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(html))) {
      const attrs = am[1] ?? "";
      const text = (am[2] ?? "").replace(/<[^>]+>/g, "").trim();
      const href = attrs.match(/\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1];
      if (!href || !isPlausibleHttpUrl(href)) continue;
      const isInterstitialCue =
        /\b(?:id|class|rel)\s*=\s*["'][^"']*(?:redirect|skip|proceed|continue|next-link|btn-continue)[^"']*["']/i.test(
          attrs,
        ) ||
        /(?:click here if you are not redirected|continue to|proceed to|skip ad|go to link)/i.test(
          text,
        );
      if (isInterstitialCue) {
        return {
          kind: "javascript-redirect",
          method: "interstitial / link-locker anchor",
          evidence: snippet(am[0]),
          rawTarget: decodeEntities(href),
          delaySeconds: null,
          deobfuscationSteps: ["Extracted destination from interstitial continue/redirect anchor"],
        };
      }
    }

    // 4. Cloaked full-page / wrapper <iframe> on thin interstitial pages (e.g. affiliate/frame cloaking)
    const iframeMatch = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/i);
    if (
      iframeMatch?.[1] &&
      isPlausibleHttpUrl(iframeMatch[1]) &&
      !/googletagmanager\.com|doubleclick\.net|facebook\.com\/tr/i.test(iframeMatch[1])
    ) {
      return {
        kind: "javascript-redirect",
        method: "cloaked full-page <iframe> frame forwarder",
        evidence: snippet(iframeMatch[0]),
        rawTarget: decodeEntities(iframeMatch[1]),
        delaySeconds: null,
        deobfuscationSteps: ["Unwrapped cloaked <iframe> destination on thin redirector page"],
      };
    }
  }

  return null;
}

/**
 * Scans an HTML document for hidden or secondary URLs (iframes, form actions,
 * data-url attributes, and Base64-encoded URLs inside scripts) so forensic
 * inspection reveals every secret endpoint referenced by the page.
 */
export function discoverHiddenArtifacts(html: string, baseUrl?: string): HiddenPageArtifact[] {
  const head = html.slice(0, 300_000);
  const artifacts: HiddenPageArtifact[] = [];
  const seen = new Set<string>();

  const add = (kind: HiddenPageArtifact["kind"], label: string, raw: string) => {
    const cleaned = decodeEntities(raw.trim());
    if (!cleaned || /^javascript:|^mailto:|^tel:|^#|^data:/i.test(cleaned)) return;
    const resolved = safeResolveUrl(cleaned, baseUrl) ?? cleaned;
    if (!/^https?:\/\//i.test(resolved)) return;
    const key = `${kind}:${resolved}`;
    if (seen.has(key)) return;
    seen.add(key);
    artifacts.push({ kind, label, url: resolved });
  };

  // 1. <iframe src="...">
  const iframeRe = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = iframeRe.exec(head)) && artifacts.length < 15) {
    if (m[1]) add("iframe", "Embedded <iframe> source", m[1]);
  }

  // 2. <form action="...">
  const formRe = /<form\b[^>]*\baction\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = formRe.exec(head)) && artifacts.length < 15) {
    if (m[1]) add("form-action", "HTML <form action>", m[1]);
  }

  // 3. data-url / data-href / data-redirect / data-src
  const dataAttrRe = /\b(data-(?:url|href|redirect|target|destination))\s*=\s*["']([^"']+)["']/gi;
  while ((m = dataAttrRe.exec(head)) && artifacts.length < 15) {
    if (m[1] && m[2]) {
      const decodedB64 = tryDecodeBase64Url(m[2]);
      if (decodedB64) {
        add("data-url", `${m[1]} (Base64 decoded)`, decodedB64);
      } else {
        add("data-url", `${m[1]} attribute`, m[2]);
      }
    }
  }

  // 4. Base64-encoded http(s) URLs in scripts or HTML (aHR0cHM6Ly8... or aHR0cDovL...)
  const b64HttpRe = /\b(aHR0c(?:HM6Ly|DovL)[A-Za-z0-9+/=_-]{10,512})\b/g;
  while ((m = b64HttpRe.exec(head)) && artifacts.length < 15) {
    const decoded = tryDecodeBase64Url(m[1]!);
    if (decoded) add("base64-script-url", "Base64-encoded URL in source", decoded);
  }

  return artifacts;
}

export function detectClientRedirect(
  html: string,
  baseUrl?: string,
): {
  signal: ClientRedirectSignal | null;
  hint: DynamicRedirectHint | null;
  hiddenArtifacts: HiddenPageArtifact[];
} {
  const head = html.slice(0, 400_000);
  const hiddenArtifacts = discoverHiddenArtifacts(head, baseUrl);

  // 1. Meta refresh
  const metaTags = head.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const content =
      tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] ??
      tag.match(/content\s*=\s*([^\s>]+)/i)?.[1];
    if (!content) continue;
    const parsed = parseRefreshValue(content);
    if (parsed?.url) {
      return {
        signal: {
          kind: "meta-refresh",
          method: `meta refresh (${parsed.delay}s)`,
          evidence: snippet(tag),
          rawTarget: parsed.url,
          delaySeconds: parsed.delay,
          deobfuscationSteps: [`Parsed HTML <meta http-equiv="refresh"> (${parsed.delay}s delay)`],
        },
        hint: null,
        hiddenArtifacts,
      };
    }
  }

  // 2. Static & De-obfuscated JavaScript location assignments (read, never executed)
  const scripts = head.match(/<script[\s\S]*?<\/script>/gi) ?? [];
  const inlineHandlers = head.match(/on(?:load|click|pageshow)\s*=\s*["'][^"']+["']/gi) ?? [];
  const rawJsBlob = [...scripts, ...inlineHandlers].join("\n");

  const { normalizedJs, steps, variables } = deobfuscateJsSource(rawJsBlob);
  const timerDelay = extractTimerDelaySeconds(normalizedJs);

  // 2a. Check direct & de-obfuscated string literal patterns
  for (const { re, method } of JS_PATTERNS) {
    const match = normalizedJs.match(re);
    const target = match?.[2] ?? match?.[4];
    if (target && !/^javascript:/i.test(target) && target.trim() !== "") {
      const cleanedTarget = decodeEntities(clean(target));
      const allSteps = [...steps];
      if (timerDelay !== null) {
        allSteps.push(`Detected setTimeout delayed execution (${timerDelay}s)`);
      }
      return {
        signal: {
          kind: "javascript-redirect",
          method: steps.length > 0 ? `${method} [de-obfuscated]` : method,
          evidence: snippet(match![0]),
          rawTarget: cleanedTarget,
          delaySeconds: timerDelay,
          ...(allSteps.length > 0 ? { deobfuscationSteps: allSteps } : {}),
        },
        hint: null,
        hiddenArtifacts,
      };
    }
  }

  // 2b. Check variable-indirected location assignments (e.g. const u = "https://..."; location.href = u)
  if (variables.size > 0) {
    for (const { re, method } of JS_VAR_PATTERNS) {
      const match = normalizedJs.match(re);
      const varName = match?.[1];
      if (varName && variables.has(varName)) {
        const resolvedVal = variables.get(varName)!;
        if (
          resolvedVal &&
          !/^javascript:/i.test(resolvedVal) &&
          (/^https?:\/\//i.test(resolvedVal) || resolvedVal.startsWith("/"))
        ) {
          const allSteps = [...steps, `Resolved JS variable "${varName}" → ${resolvedVal}`];
          if (timerDelay !== null) {
            allSteps.push(`Detected setTimeout delayed execution (${timerDelay}s)`);
          }
          return {
            signal: {
              kind: "javascript-redirect",
              method: `${method} [resolved]`,
              evidence: snippet(match![0]),
              rawTarget: decodeEntities(clean(resolvedVal)),
              delaySeconds: timerDelay,
              deobfuscationSteps: allSteps,
            },
            hint: null,
            hiddenArtifacts,
          };
        }
      }
    }
  }

  // 3. Auto-submitted HTML <form action="..."> redirect
  const formSignal = detectAutoSubmitFormRedirect(head, normalizedJs, baseUrl);
  if (formSignal) {
    return { signal: formSignal, hint: null, hiddenArtifacts };
  }

  // 4. Framework hydration (__NEXT_DATA__), data-redirect attributes, or interstitial skip links
  const interstitialSignal = detectHydrationOrInterstitialRedirect(head);
  if (interstitialSignal) {
    return { signal: interstitialSignal, hint: null, hiddenArtifacts };
  }

  // 5. Isolated Mock-DOM VM Sandbox (unpacks Dean Edwards Packer eval(function(p,a,c,k,e,d)...),
  // _0x array-indexed obfuscation, XOR/charCode loops, and location.search / location.hash readers)
  const vmSignal = evaluateScriptsInSandbox(scripts, baseUrl, head);
  if (vmSignal) {
    return { signal: vmSignal, hint: null, hiddenArtifacts };
  }

  // 6. Dynamic hints that require a real headless browser
  for (const { re, method } of DYNAMIC_HINTS) {
    const match = normalizedJs.match(re);
    if (match)
      return { signal: null, hint: { method, evidence: snippet(match[0]) }, hiddenArtifacts };
  }

  return { signal: null, hint: null, hiddenArtifacts };
}

/**
 * Patterns that indicate a script is attempting prototype-chain traversal or host-realm probing
 * rather than performing a legitimate client-side redirect.
 */
const VM_ESCAPE_PROBE_RE =
  /(?:__proto__|\bconstructor\b|getPrototypeOf|setPrototypeOf|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__|\bprocess\b|\brequire\b|\bimport\s*\(|\bReflect\b)/;

/**
 * Self-contained Mock-DOM bootstrap evaluated INSIDE the isolated Node `vm` realm so
 * every object, function, and proxy inherits strictly from the VM's own intrinsics
 * and zero host functions/objects are ever reachable via prototype chains.
 */
const VM_REALM_BOOTSTRAP = `
(function(initJson) {
  const init = JSON.parse(initJson);
  const base = init.base;
  const state = { url: null, method: "computed JavaScript navigation", delay: null, written: "" };

  function recordTarget(val, method) {
    if (state.url) return;
    if (typeof val !== "string") return;
    const trimmed = val.trim();
    if (!trimmed || /^javascript:/i.test(trimmed)) return;
    if (trimmed !== base.href) {
      state.url = trimmed;
      state.method = method;
    }
  }

  function pureAtob(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const s = String(str).replace(/[\\t\\n\\f\\r =]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    let output = "";
    let bc = 0, bs = 0, buffer, idx = 0;
    while ((buffer = s.charAt(idx++))) {
      buffer = chars.indexOf(buffer);
      if (~buffer) {
        bs = bc % 4 ? bs * 64 + buffer : buffer;
        if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
      }
    }
    return output;
  }

  function pureBtoa(str) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const s = String(str);
    let output = "";
    for (let block = 0, charCode, idx = 0, map = chars;
      s.charAt(idx | 0) || ((map = "="), idx % 1);
      output += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))
    ) {
      charCode = s.charCodeAt((idx += 3 / 4));
      block = (block << 8) | charCode;
    }
    return output;
  }

  function SimpleSearchParams(searchStr) {
    const map = Object.create(null);
    const clean = String(searchStr || "").replace(/^\\?/, "");
    if (clean) {
      for (const pair of clean.split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = eq === -1 ? decodeURIComponent(pair) : decodeURIComponent(pair.slice(0, eq));
        const v = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
        if (!(k in map)) map[k] = v;
      }
    }
    this.get = function(k) { return k in map ? map[k] : null; };
    this.has = function(k) { return k in map; };
  }

  function SimpleURL(input, baseInput) {
    const raw = String(input || "");
    this.href = raw;
    this.search = raw.includes("?") ? "?" + raw.split("?")[1].split("#")[0] : base.search;
    this.hash = raw.includes("#") ? "#" + raw.split("#")[1] : "";
    this.searchParams = new SimpleSearchParams(this.search);
    this.toString = function() { return this.href; };
  }

  const locState = {
    _href: base.href,
    protocol: base.protocol,
    host: base.host,
    hostname: base.hostname,
    port: base.port,
    pathname: base.pathname,
    search: base.search,
    hash: base.hash,
    origin: base.origin,
    get href() { return this._href; },
    set href(v) {
      this._href = String(v);
      recordTarget(this._href, "computed location.href");
    },
    replace: function(v) { recordTarget(String(v), "computed location.replace()"); },
    assign: function(v) { recordTarget(String(v), "computed location.assign()"); },
    reload: function() {},
    toString: function() { return this._href; }
  };

  function makeElem(initialHref, initialAction) {
    const el = {
      href: initialHref || "",
      src: "",
      action: initialAction || "",
      value: "",
      innerHTML: "",
      textContent: "",
      style: {},
      setAttribute: function(k, v) {
        if (k === "href") el.href = String(v);
        if (k === "action") el.action = String(v);
        if (k === "href" || k === "action") recordTarget(String(v), 'element.setAttribute("' + k + '")');
      },
      getAttribute: function(k) {
        return k === "href" ? (el.href || null) : k === "action" ? (el.action || null) : null;
      },
      click: function() {
        if (typeof el.href === "string" && el.href) recordTarget(el.href, "computed element.click()");
        else if (typeof el.action === "string" && el.action) recordTarget(el.action, "computed form.click()");
      },
      submit: function() {
        if (typeof el.action === "string" && el.action) recordTarget(el.action, "computed form.submit()");
      },
      requestSubmit: function() {
        if (typeof el.action === "string" && el.action) recordTarget(el.action, "computed form.requestSubmit()");
      },
      appendChild: function() {},
      addEventListener: function() {}
    };
    return el;
  }

  const byId = Object.create(null);
  for (const k of Object.keys(init.byId)) {
    byId[k] = makeElem(init.byId[k].href, init.byId[k].action);
  }
  const forms = init.forms.map(function(f) { return makeElem(f.href, f.action); });

  let timerCalls = 0;
  function immediateTimer(fn, delay) {
    if (timerCalls >= 4) return 1;
    timerCalls++;
    if (typeof delay === "number" && delay > 0) {
      state.delay = Math.round((delay / 1000) * 10) / 10;
    }
    try {
      if (typeof fn === "function") fn();
    } catch (e) {}
    return timerCalls;
  }

  const docObj = {
    get location() { return locState; },
    set location(v) { recordTarget(String(v), "computed document.location"); },
    URL: base.href,
    domain: base.hostname,
    referrer: "",
    cookie: "",
    body: makeElem("", ""),
    head: makeElem("", ""),
    forms: forms,
    getElementById: function(id) {
      const key = String(id || "").trim();
      return byId[key] || makeElem("", "");
    },
    querySelector: function(sel) {
      const s = String(sel || "").trim();
      if (s.charAt(0) === "#" && byId[s.slice(1)]) return byId[s.slice(1)];
      return makeElem("", "");
    },
    querySelectorAll: function() { return []; },
    getElementsByTagName: function() { return []; },
    getElementsByClassName: function() { return []; },
    createElement: function() { return makeElem("", ""); },
    addEventListener: function(ev, cb) {
      if ((ev === "DOMContentLoaded" || ev === "load") && typeof cb === "function" && timerCalls < 4) {
        timerCalls++;
        try { cb(); } catch (e) {}
      }
    },
    write: function(str) { if (typeof str === "string") state.written += str; },
    writeln: function(str) { if (typeof str === "string") state.written += str + "\\n"; }
  };

  const g = globalThis;
  Object.defineProperty(g, "location", {
    get: function() { return locState; },
    set: function(v) { recordTarget(String(v), "computed window.location"); },
    configurable: true
  });
  g.document = docObj;
  g.navigator = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    language: "en-US",
    webdriver: false
  };
  g.history = {
    pushState: function(_s, _t, u) { if (typeof u === "string") recordTarget(u, "history.pushState()"); },
    replaceState: function(_s, _t, u) { if (typeof u === "string") recordTarget(u, "history.replaceState()"); }
  };
  g.setTimeout = immediateTimer;
  g.setInterval = immediateTimer;
  g.clearTimeout = function() {};
  g.clearInterval = function() {};
  g.requestAnimationFrame = immediateTimer;
  g.open = function(u) { if (typeof u === "string") recordTarget(u, "computed window.open()"); return null; };
  g.atob = pureAtob;
  g.btoa = pureBtoa;
  g.URL = SimpleURL;
  g.URLSearchParams = SimpleSearchParams;
  g.console = { log: function(){}, warn: function(){}, error: function(){} };
  g.window = g;
  g.self = g;
  g.top = g;
  g.parent = g;
  g.__readSandboxState = function() { return JSON.stringify(state); };
})
`;

/**
 * Executes inline <script> blocks inside a strictly time-boxed (45ms), zero-privilege
 * Node `vm` Mock-DOM context with NO network/filesystem/process access and zero host
 * object references.
 */
function evaluateScriptsInSandbox(
  scriptTags: string[],
  baseUrl?: string,
  htmlSnapshot = "",
): ClientRedirectSignal | null {
  if (scriptTags.length === 0) return null;
  let vmModule: typeof import("node:vm") | null = null;
  try {
    const proc = globalThis as unknown as {
      process?: { getBuiltinModule?: (id: string) => typeof import("node:vm") };
    };
    vmModule = proc.process?.getBuiltinModule?.("node:vm") ?? null;
  } catch {
    vmModule = null;
  }
  if (!vmModule) return null;

  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl || "https://example.com/");
  } catch {
    parsedBase = new URL("https://example.com/");
  }

  // Index static elements from HTML by id and collect all <form> elements for document.forms[0]
  const byId: Record<string, { href: string; action: string }> = {};
  const forms: Array<{ href: string; action: string }> = [];
  const idAttrRe = /<(a|form|iframe|button)\b([^>]*)>/gi;
  let idm: RegExpExecArray | null;
  while ((idm = idAttrRe.exec(htmlSnapshot)) && Object.keys(byId).length + forms.length < 60) {
    const tagName = (idm[1] ?? "").toLowerCase();
    const tagAttrs = idm[2] ?? "";
    const idVal = tagAttrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    const hrefVal = decodeEntities(tagAttrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "");
    const actVal = decodeEntities(tagAttrs.match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1] ?? "");
    if (tagName === "form" && actVal) {
      forms.push({ href: hrefVal, action: actVal });
    }
    if (idVal) {
      byId[idVal] = { href: hrefVal, action: actVal };
    }
  }

  const initPayload = JSON.stringify({
    base: {
      href: parsedBase.href,
      protocol: parsedBase.protocol,
      host: parsedBase.host,
      hostname: parsedBase.hostname,
      port: parsedBase.port,
      pathname: parsedBase.pathname,
      search: parsedBase.search,
      hash: parsedBase.hash,
      origin: parsedBase.origin,
    },
    byId,
    forms,
  });

  for (const tag of scriptTags.slice(0, 10)) {
    const code = tag
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    if (!code || code.length > 120_000) continue;
    if (VM_ESCAPE_PROBE_RE.test(code)) continue;
    // Only run sandbox on scripts that reference navigation/encoding/eval/DOM-click cues
    if (
      !/location|href|replace|assign|open|eval|atob|fromCharCode|decodeURIComponent|unescape|searchParams|hash|_0x|write|getElementById|querySelector|click|submit|forms/i.test(
        code,
      )
    ) {
      continue;
    }

    let capturedUrl: string | null = null;
    let capturedMethod = "computed JavaScript navigation";
    let capturedDelay: number | null = null;
    let writtenHtml = "";

    try {
      // Null-prototype context with zero host object references
      const ctx = vmModule.createContext(Object.create(null), {
        codeGeneration: { strings: true, wasm: false },
      });
      const bootstrapFn = vmModule.runInContext(VM_REALM_BOOTSTRAP, ctx, { timeout: 25 }) as (
        json: string,
      ) => void;
      bootstrapFn(initPayload);
      vmModule.runInContext(code, ctx, { timeout: 45 });
      const rawOut = vmModule.runInContext("__readSandboxState()", ctx, { timeout: 15 });
      if (typeof rawOut === "string") {
        const parsedOut = JSON.parse(rawOut) as {
          url: string | null;
          method: string;
          delay: number | null;
          written: string;
        };
        capturedUrl = parsedOut.url;
        capturedMethod = parsedOut.method;
        capturedDelay = parsedOut.delay;
        writtenHtml = parsedOut.written;
      }
    } catch {
      // ignore script runtime or timeout errors
    }

    if (capturedUrl) {
      const steps = ["Evaluated dynamic/packed JavaScript inside isolated Mock-DOM VM sandbox"];
      if (capturedDelay !== null) {
        steps.push(`Accelerated setTimeout timer (${capturedDelay}s)`);
      }
      return {
        kind: "javascript-redirect",
        method: `${capturedMethod} [VM sandbox]`,
        evidence: snippet(code),
        rawTarget: decodeEntities(clean(capturedUrl)),
        delaySeconds: capturedDelay,
        deobfuscationSteps: steps,
      };
    }

    if (writtenHtml) {
      const inner = detectClientRedirect(writtenHtml, baseUrl);
      if (inner.signal) {
        return {
          ...inner.signal,
          deobfuscationSteps: [
            "Captured dynamic document.write() payload in Mock-DOM VM sandbox",
            ...(inner.signal.deobfuscationSteps ?? []),
          ],
        };
      }
    }
  }

  return null;
}

function matchMetaContent(html: string, attrName: string, attrValue: string): string | null {
  const re = new RegExp(`<meta[^>]+${attrName}\\s*=\\s*["']${attrValue}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content.trim()) : null;
}

export interface ExtractedPageMeta {
  canonical: string | null;
  metaRobots: string | null;
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  hreflangCount: number;
}

export function extractPageMeta(html: string, baseUrl?: string): ExtractedPageMeta {
  const head = html.slice(0, 250_000);
  const rawCanonical =
    head
      .match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]
      ?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  const canonical = safeResolveUrl(rawCanonical, baseUrl);
  const metaRobots = matchMetaContent(head, "name", "robots");
  const rawTitle = head.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]?.trim() ?? null;
  const title = rawTitle ? decodeEntities(rawTitle.replace(/\s+/g, " ")) : null;
  const description = matchMetaContent(head, "name", "description");
  const ogTitle =
    matchMetaContent(head, "property", "og:title") ?? matchMetaContent(head, "name", "og:title");
  const ogDescription =
    matchMetaContent(head, "property", "og:description") ??
    matchMetaContent(head, "name", "og:description");
  const rawOgImage =
    matchMetaContent(head, "property", "og:image") ?? matchMetaContent(head, "name", "og:image");
  const ogImage = safeResolveUrl(rawOgImage, baseUrl);
  const twitterCard =
    matchMetaContent(head, "name", "twitter:card") ??
    matchMetaContent(head, "property", "twitter:card");
  const hreflangMatches = head.match(/<link[^>]+hreflang\s*=\s*["'][^"']+["'][^>]*>/gi);
  const hreflangCount = hreflangMatches ? hreflangMatches.length : 0;

  return {
    canonical,
    metaRobots,
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    hreflangCount,
  };
}

/**
 * True when a page looks like a thin interstitial/redirector rather than real
 * content. Used to avoid flagging ordinary script-heavy pages (Google, SPAs)
 * as unresolved client-side redirects.
 */
export function looksLikeRedirector(html: string): boolean {
  if (html.length > 60_000) return false;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 1200;
}

const JSON_REDIRECT_KEYS = new Set([
  "url",
  "redirect",
  "redirecturl",
  "redirect_url",
  "target",
  "targeturl",
  "target_url",
  "location",
  "destination",
  "dest",
  "next",
  "nexturl",
  "next_url",
  "link",
  "href",
  "goto",
  "forward",
  "fallbackurl",
  "fallback_url",
]);

/**
 * Extracts a redirect destination URL from an API / AJAX JSON payload, including
 * nested `{ data: { url: "..." } }` or `{ result: { redirectUrl: "..." } }` structures.
 */
export function extractJsonRedirectTarget(
  jsonText: string,
): { url: string; keyPath: string } | null {
  const trimmed = jsonText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const visit = (
    node: unknown,
    path: string,
    depth: number,
  ): { url: string; keyPath: string } | null => {
    if (depth > 4 || !node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (let idx = 0; idx < Math.min(node.length, 5); idx++) {
        const hit = visit(node[idx], `${path}[${idx}]`, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const entries = Object.entries(node as Record<string, unknown>);
    // Prefer matching redirect keys directly at current depth
    for (const [k, v] of entries) {
      if (typeof v === "string" && JSON_REDIRECT_KEYS.has(k.toLowerCase())) {
        const val = v.trim();
        if (isPlausibleHttpUrl(val) || val.startsWith("/")) {
          return { url: val, keyPath: path ? `${path}.${k}` : k };
        }
      }
    }
    // Recurse into sub-objects (e.g. data, result, payload)
    for (const [k, v] of entries) {
      if (v && typeof v === "object") {
        const hit = visit(v, path ? `${path}.${k}` : k, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };

  return visit(parsed, "", 0);
}

/**
 * Extracts a concise, human-readable upstream block/error reason from a JSON or
 * HTML 4xx/5xx body (e.g. `{"status":"failed","message":"Access not allowed through a VPN or proxy"}`).
 */
export function extractUpstreamBlockReason(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["message", "error", "reason", "detail", "error_description", "msg"]) {
        const val = obj[key];
        if (typeof val === "string" && val.trim().length > 2) {
          return val.trim().slice(0, 220);
        }
        if (
          val &&
          typeof val === "object" &&
          typeof (val as Record<string, unknown>)["message"] === "string"
        ) {
          return String((val as Record<string, unknown>)["message"])
            .trim()
            .slice(0, 220);
        }
      }
    } catch {
      // fall through to text check
    }
  }

  // Thin HTML error page
  const cleaned = trimmed
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 6 && cleaned.length <= 260) {
    return cleaned.slice(0, 220);
  }
  const titleMatch = trimmed.match(/<title[^>]*>([^<]{3,160})<\/title>/i)?.[1]?.trim();
  if (titleMatch && !/just a moment|cloudflare/i.test(titleMatch)) {
    return decodeEntities(titleMatch).slice(0, 180);
  }
  return null;
}

/**
 * Returns true if an upstream rejection message indicates OS / device / browser
 * gating so the trace engine can automatically adapt its User-Agent & Client Hints.
 */
export function isOsOrDeviceRejectionMessage(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /(?:operating system|mobile only|desktop only|android only|ios only|device not allowed|device not supported|unsupported device|platform not allowed|browser not supported|wrong device|mobile traffic only)/i.test(
    reason,
  );
}
