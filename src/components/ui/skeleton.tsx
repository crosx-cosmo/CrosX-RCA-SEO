import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-shimmer relative overflow-hidden rounded-md bg-foreground/[0.075] dark:bg-foreground/[0.095]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
