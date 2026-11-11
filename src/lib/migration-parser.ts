/**
 * Sitemap XML, Apache `.htaccess`, and Nginx Redirect Migration Parser.
 *
 * Extracts testable http(s) URLs and redirect rules from:
 *  1. XML Sitemaps (`<loc>https://...</loc>`)
 *  2. Apache `.htaccess` (`Redirect 301 /old https://...`, `RewriteRule ^old$ https://...`)
 *  3. Nginx configs (`return 301 https://...`, `rewrite ^/old$ https://... permanent`)
 *  4. Plain text / CSV lists
 */

export interface ExtractedMigrationRule {
  sourcePattern: string;
  testUrl: string;
  expectedTarget: string | null;
  statusCode: number | null;
  format: "sitemap-xml" | "htaccess" | "nginx" | "url-list";
}

export interface MigrationParseResult {
  format: "sitemap-xml" | "htaccess" | "nginx" | "url-list";
  urls: string[];
  rules: ExtractedMigrationRule[];
}

export function parseMigrationInput(
  rawText: string,
  baseOrigin = "https://example.com",
  maxUrls = 20,
): MigrationParseResult {
  const cleanOrigin = baseOrigin.replace(/\/+$/, "");
  const trimmed = rawText.trim();

  // 1. Check for XML Sitemap (<loc>...</loc>)
  if (/<urlset|<sitemapindex|<loc>/i.test(trimmed)) {
    const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    const urls: string[] = [];
    const rules: ExtractedMigrationRule[] = [];
    let match: RegExpExecArray | null;
    while ((match = locRegex.exec(trimmed)) !== null) {
      const candidate = match[1]
        ?.replace(/&amp;/g, "&")
        ?.replace(/&lt;/g, "<")
        ?.replace(/&gt;/g, ">")
        ?.trim();
      if (candidate && /^https?:\/\//i.test(candidate) && !urls.includes(candidate)) {
        urls.push(candidate);
        rules.push({
          sourcePattern: candidate,
          testUrl: candidate,
          expectedTarget: null,
          statusCode: 200,
          format: "sitemap-xml",
        });
        if (urls.length >= maxUrls) break;
      }
    }
    return { format: "sitemap-xml", urls, rules };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  // 2. Check for Apache .htaccess (Redirect / RedirectMatch / RewriteRule)
  if (lines.some((l) => /^(?:Redirect|RedirectMatch|RewriteRule)\b/i.test(l))) {
    const rules: ExtractedMigrationRule[] = [];
    const urls: string[] = [];

    for (const line of lines) {
      // Match: Redirect [301|permanent] /old-path https://example.com/new-path
      const redirectMatch =
        /^Redirect(?:Match)?\s+(?:(301|302|307|308|permanent|temp)\s+)?(\S+)\s+(\S+)/i.exec(line);
      if (redirectMatch) {
        const rawCode = redirectMatch[1]?.toLowerCase();
        const code =
          rawCode === "permanent"
            ? 301
            : rawCode === "temp"
              ? 302
              : rawCode
                ? Number(rawCode)
                : 302;
        const fromPath = redirectMatch[2]!.replace(/^\^|\$$/g, "");
        const target = redirectMatch[3]!;
        const testUrl = /^https?:\/\//i.test(fromPath)
          ? fromPath
          : `${cleanOrigin}${fromPath.startsWith("/") ? "" : "/"}${fromPath}`;
        const expectedTarget = /^https?:\/\//i.test(target)
          ? target
          : `${cleanOrigin}${target.startsWith("/") ? "" : "/"}${target}`;

        if (!urls.includes(testUrl)) {
          urls.push(testUrl);
          rules.push({
            sourcePattern: fromPath,
            testUrl,
            expectedTarget,
            statusCode: code,
            format: "htaccess",
          });
        }
        if (urls.length >= maxUrls) break;
        continue;
      }

      // Match: RewriteRule ^/?old-page/?$ https://example.com/new-page [R=301,L]
      const rewriteMatch = /^RewriteRule\s+(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?/i.exec(line);
      if (rewriteMatch) {
        const rawPattern = rewriteMatch[1]!;
        const target = rewriteMatch[2]!;
        const flags = rewriteMatch[3] ?? "";
        if (target === "-") continue;
        const cleanPath = rawPattern
          .replace(/^\^\/?\??/, "/")
          .replace(/\/\?\$$|\$$/, "")
          .replace(/\(.*\)/g, "sample");
        const testUrl = `${cleanOrigin}${cleanPath.startsWith("/") ? "" : "/"}${cleanPath}`;
        const expectedTarget = /^https?:\/\//i.test(target)
          ? target
          : `${cleanOrigin}${target.startsWith("/") ? "" : "/"}${target}`;
        const rCodeMatch = /R=(301|302|307|308)/i.exec(flags);
        const statusCode = rCodeMatch ? Number(rCodeMatch[1]) : 302;

        if (!urls.includes(testUrl)) {
          urls.push(testUrl);
          rules.push({
            sourcePattern: rawPattern,
            testUrl,
            expectedTarget,
            statusCode,
            format: "htaccess",
          });
        }
        if (urls.length >= maxUrls) break;
      }
    }

    if (urls.length > 0) {
      return { format: "htaccess", urls, rules };
    }
  }

  // 3. Check for Nginx config (rewrite ^/old$ https://... permanent; or location = /old { return 301 ... })
  if (lines.some((l) => /\b(?:rewrite|return\s+30[1278])\b/i.test(l))) {
    const rules: ExtractedMigrationRule[] = [];
    const urls: string[] = [];
    let currentLocationPath: string | null = null;

    for (const line of lines) {
      const locMatch = /^location\s+(?:=\s+|~\*?\s+)?(\S+)\s*\{?/i.exec(line);
      if (locMatch) {
        currentLocationPath = locMatch[1]!.replace(/^\^|\$$/g, "");
      }

      const returnMatch = /\breturn\s+(301|302|307|308)\s+([^;\s]+)\s*;?/i.exec(line);
      if (returnMatch && currentLocationPath) {
        const statusCode = Number(returnMatch[1]);
        const target = returnMatch[2]!.replace(/\$request_uri|\$is_args\$args/g, "");
        const testUrl = `${cleanOrigin}${currentLocationPath.startsWith("/") ? "" : "/"}${currentLocationPath}`;
        const expectedTarget = /^https?:\/\//i.test(target)
          ? target
          : `${cleanOrigin}${target.startsWith("/") ? "" : "/"}${target}`;
        if (!urls.includes(testUrl)) {
          urls.push(testUrl);
          rules.push({
            sourcePattern: currentLocationPath,
            testUrl,
            expectedTarget,
            statusCode,
            format: "nginx",
          });
        }
        if (urls.length >= maxUrls) break;
        continue;
      }

      const nginxRewrite = /^rewrite\s+(\S+)\s+(\S+)(?:\s+(permanent|redirect))?\s*;?/i.exec(line);
      if (nginxRewrite) {
        const rawPattern = nginxRewrite[1]!
          .replace(/^\^/, "")
          .replace(/\$$/, "")
          .replace(/\(.*\)/g, "sample");
        const target = nginxRewrite[2]!.replace(/\$\d+/g, "");
        const flag = nginxRewrite[3]?.toLowerCase();
        const statusCode = flag === "permanent" ? 301 : 302;
        const testUrl = `${cleanOrigin}${rawPattern.startsWith("/") ? "" : "/"}${rawPattern}`;
        const expectedTarget = /^https?:\/\//i.test(target)
          ? target
          : `${cleanOrigin}${target.startsWith("/") ? "" : "/"}${target}`;
        if (!urls.includes(testUrl)) {
          urls.push(testUrl);
          rules.push({
            sourcePattern: nginxRewrite[1]!,
            testUrl,
            expectedTarget,
            statusCode,
            format: "nginx",
          });
        }
        if (urls.length >= maxUrls) break;
      }
    }

    if (urls.length > 0) {
      return { format: "nginx", urls, rules };
    }
  }

  // 4. Default URL list / CSV fallback
  const urls = rawText
    .split(/[\r\n,;]+/)
    .map((cell) => cell.replace(/^["']|["']$/g, "").trim())
    .filter((cell) => /^https?:\/\/\S+/i.test(cell))
    .filter((u, idx, arr) => arr.indexOf(u) === idx)
    .slice(0, maxUrls);

  return {
    format: "url-list",
    urls,
    rules: urls.map((u) => ({
      sourcePattern: u,
      testUrl: u,
      expectedTarget: null,
      statusCode: null,
      format: "url-list",
    })),
  };
}
