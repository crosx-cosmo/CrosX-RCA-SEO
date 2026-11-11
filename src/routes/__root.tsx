import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, themeInitScript } from "@/lib/theme";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { DEFAULT_OG_IMAGE, DEFAULT_OG_IMAGE_ALT, SITE_HOST, SITE_NAME, SITE_URL } from "@/lib/seo";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_NAME },
      {
        name: "description",
        content:
          "Trace any URL end to end: HTTP 301/302/307/308 redirects, meta refresh, JavaScript navigation, cloaked affiliate hops, loops, dead ends and tracking parameter loss.",
      },
      { name: "author", content: "CROSX" },
      { name: "publisher", content: "CROSX" },
      { name: "format-detection", content: "telephone=no, date=no, email=no, address=no" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:locale", content: "en_US" },
      { property: "og:title", content: SITE_NAME },
      {
        property: "og:description",
        content:
          "Trace any URL end to end: HTTP 301/302/307/308 redirects, meta refresh, JavaScript navigation, cloaked affiliate hops, loops, dead ends and tracking parameter loss.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}/` },
      {
        property: "og:image",
        content: DEFAULT_OG_IMAGE,
      },
      { property: "og:image:secure_url", content: DEFAULT_OG_IMAGE },
      { property: "og:image:width", content: "512" },
      { property: "og:image:height", content: "512" },
      {
        property: "og:image:alt",
        content: DEFAULT_OG_IMAGE_ALT,
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:domain", content: SITE_HOST },
      { name: "twitter:url", content: `${SITE_URL}/` },
      { name: "twitter:title", content: SITE_NAME },
      {
        name: "twitter:description",
        content:
          "Trace any URL end to end: HTTP 301/302/307/308 redirects, meta refresh, JavaScript navigation, cloaked affiliate hops, loops, dead ends and tracking parameter loss.",
      },
      {
        name: "twitter:image",
        content: DEFAULT_OG_IMAGE,
      },
      { name: "application-name", content: "Redirect Chain Analyzer" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Redirect Analyzer" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "theme-color", content: "#fbfbfb", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#131313", media: "(prefers-color-scheme: dark)" },
    ],

    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "preconnect",
        href: "https://xtprixndtsnctglngxwl.supabase.co",
        crossOrigin: "anonymous",
      },
      { rel: "dns-prefetch", href: "https://xtprixndtsnctglngxwl.supabase.co" },
      { rel: "dns-prefetch", href: "https://rca.api.crosx.in" },
      { rel: "dns-prefetch", href: "https://bauval.org" },
      { rel: "preconnect", href: "https://bauval.org", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "64x64" },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts: [
      {
        children: themeInitScript,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
