// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isLovableSandbox =
  process.env["LOVABLE_SANDBOX"] === "1" || Boolean(process.env["DEV_SERVER__PROJECT_PATH"]);

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-router",
        "@tanstack/react-query",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/react-router",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "@radix-ui/react-accordion",
        "@radix-ui/react-dialog",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-label",
        "@radix-ui/react-select",
        "@radix-ui/react-slot",
        "@radix-ui/react-switch",
        "@radix-ui/react-tooltip",
        "@supabase/supabase-js",
        "class-variance-authority",
        "clsx",
        "lucide-react",
        "qrcode",
        "seroval",
        "sonner",
        "tailwind-merge",
        "zod",
      ],
    },
    ...(isLovableSandbox
      ? {}
      : {
          server: {
            host: "0.0.0.0",
            port: 3000,
            hmr: process.env["DISABLE_HMR"] !== "true",
            watch: process.env["DISABLE_HMR"] === "true" ? null : {},
          },
        }),
  },
});
