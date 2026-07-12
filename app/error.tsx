"use client";

/**
 * Route-level error boundary. Without this, any client render error unmounts the
 * tree and leaves a white screen (hub-nav.js keeps <html> hidden until reveal, so
 * a crash reads as a blank page). This catches it and offers a recovery path.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        ShadowData hit an unexpected error rendering this view. Your data isn&apos;t lost — try again.
      </p>
      {error?.message && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface p-3 text-left text-xs text-bear">
          {error.message}
        </pre>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={reset} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
          Try again
        </button>
        <button
          onClick={() => (window.location.href = "/")}
          className="rounded-lg border border-border px-5 py-2.5 text-sm"
        >
          Back to search
        </button>
      </div>
    </main>
  );
}
