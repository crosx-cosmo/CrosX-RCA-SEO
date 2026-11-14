import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { routeTree } from "./routeTree.gen";

function RoutePendingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className="bg-hero min-h-screen"
    >
      <div className="border-b border-hairline bg-background/70">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <Skeleton className="h-6 w-28 rounded-md" />
          <Skeleton className="h-6 w-px" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-44 rounded-md" />
            <Skeleton className="hidden h-3 w-64 rounded-md sm:block" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-7 sm:px-6 sm:py-10">
        <div className="space-y-3">
          <Skeleton className="h-6 w-36 rounded-full" />
          <Skeleton className="h-9 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-2/3 rounded-md" />
        </div>
        <div className="panel space-y-4 p-4 sm:p-6">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
        </div>
        <div className="panel space-y-4 p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-hairline bg-surface-muted p-4">
                <Skeleton className="h-3 w-20 rounded-full" />
                <Skeleton className="mt-3 h-6 w-16 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultPendingComponent: RoutePendingSkeleton,
    defaultPendingMs: 120,
    defaultPendingMinMs: 250,
  });

  return router;
};
