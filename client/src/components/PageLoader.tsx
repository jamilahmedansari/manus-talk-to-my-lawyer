import { Loader2 } from "lucide-react";

/**
 * Lightweight loading spinner used as Suspense fallback for lazy-loaded pages.
 * Keeps the initial bundle small — no heavy dependencies.
 */
export default function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
