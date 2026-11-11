export type IssueLevel = "error" | "warning" | "info";

/** How the analyzer moved (or failed to move) from one URL to the next. */
export type HopMechanism =
  | "http-redirect"
  | "javascript-redirect"
  | "meta-refresh"
  | "form-redirect"
  | "gateway-unwrap"
  | "browser-navigation"
  | "final-response"
  | "blocked"
  | "unresolved"
  | "error";

export interface HopCookieInfo {
  name: string;
  valuePreview: string;
  flags: string[];
}

export interface EmbeddedTargetInfo {
  source: string;
  url: string;
  encoding: "raw" | "url-encoded" | "double-url-encoded" | "base64" | "hex" | "gateway-path";
}

export interface HiddenPageArtifact {
  kind:
    | "iframe"
    | "form-action"
    | "data-url"
    | "base64-script-url"
    | "interstitial-link"
    | "hydration-url";
  label: string;
  url: string;
}

export interface HopForensics {
  /** Step-by-step trace of how an obfuscated or secret redirect was decoded. */
  deobfuscationSteps?: string[];
  /** Cookies set by the server on this hop via Set-Cookie. */
  cookiesSet?: HopCookieInfo[];
  /** Cookie names sent to the server on this hop from prior hops in the chain. */
  cookiesSent?: string[];
  /** Referer header sent on this hop. */
  refererSent?: string | null;
  /** Target URLs discovered embedded inside this hop's URL query/path. */
  embeddedTargets?: EmbeddedTargetInfo[];
  /** Hidden or secondary URLs discovered in the HTML body (iframes, data-url, base64, forms). */
  hiddenArtifacts?: HiddenPageArtifact[];
  /** Security header posture on this hop. */
  securityHeaders?: {
    hsts: boolean;
    csp: boolean;
    xFrameOptions: string | null;
    referrerPolicy: string | null;
  };
}

export interface RedirectHop {
  index: number;
  url: string;
  protocol: "http" | "https" | "other";
  status: number;
  statusText: string;
  redirectType: string;
  responseTimeMs: number;
  location: string | null;
  resolvedLocation: string | null;
  server: string | null;
  ip: string | null;
  headers: Record<string, string>;
  params: Record<string, string>;
  /** Mechanism that produced the next hop (or ended the chain). */
  mechanism?: HopMechanism;
  /** Human label shown on the hop card, e.g. "JavaScript Redirect". */
  mechanismLabel?: string;
  /** Precise technique, e.g. "location.replace()" or "meta refresh (0s)". */
  mechanismDetail?: string | null;
  /** Source fragment the detection was based on. */
  evidence?: string | null;
  /** Unified destination for this hop, whatever the mechanism was. */
  nextUrl?: string | null;
  /** Exact reason the chain could not continue from this hop. */
  blockedReason?: string | null;
  /** IP addresses the hostname resolved to during the safety check. */
  addresses?: string[];
  /** Deep forensic telemetry for secret, obfuscated, or cookie-gated hops. */
  forensics?: HopForensics;
}

export interface AnalysisIssue {
  id: string;
  level: IssueLevel;
  title: string;
  detail: string;
  hopIndex?: number;
}

export type UserAgentPreset =
  | "desktop-chrome"
  | "mobile-iphone"
  | "mobile-android"
  | "googlebot-smartphone"
  | "googlebot-desktop"
  | "social-bot";

export interface SeoInfo {
  finalStatus: number | null;
  https: boolean;
  canonical: string | null;
  metaRobots: string | null;
  chainLength: number;
  xRobotsTag?: string | null;
  hsts?: boolean;
  cacheControl?: string | null;
  canonicalStatus?: "match" | "mismatch" | "missing";
  temporaryRedirectsCount?: number;
  cleanFinalUrl?: string;
  title?: string | null;
  description?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  twitterCard?: string | null;
  hreflangCount?: number;
}

export type ParamChangeKind = "added" | "removed" | "modified";

export interface ParamChange {
  param: string;
  kind: ParamChangeKind;
  from: string | null;
  to: string | null;
  tracking: boolean;
}

export interface HopParamDiff {
  fromIndex: number;
  toIndex: number;
  fromUrl: string;
  toUrl: string;
  changes: ParamChange[];
}

export interface TrackingReport {
  diffs: HopParamDiff[];
  startParams: Record<string, string>;
  finalParams: Record<string, string>;
  lostTrackingParams: string[];
  keptTrackingParams: string[];
}

export interface RedirectAnalysis {
  startUrl: string;
  hops: RedirectHop[];
  finalUrl: string;
  finalStatus: number | null;
  totalHops: number;
  totalRedirects: number;
  totalResponseTimeMs: number;
  redirectLoop: boolean;
  seo: SeoInfo;
  issues: AnalysisIssue[];
  tracking: TrackingReport;
  source: "live" | "demo";
  analyzedAt: string;
  error: string | null;
  /** User-Agent preset used to perform the trace. */
  userAgentPreset?: UserAgentPreset;
  /** Human-readable label for the User-Agent preset. */
  userAgentLabel?: string;
  /** Why tracing stopped: "final-response" | "blocked" | "loop" | ... */
  terminationReason?: string;
  /** Plain-language explanation of the termination. */
  terminationDetail?: string | null;
  /** True when the final destination is confirmed (no unfollowable hop left). */
  finalDestinationConfirmed?: boolean;
  /** Set when the headless-browser fallback was used for at least one hop. */
  browserFallbackUsed?: boolean;
  /** Reason the browser fallback could not run, when it was needed. */
  browserFallbackNote?: string | null;
}
