"use client";

/**
 * Last-resort boundary for errors in the root layout itself. Must render its own
 * <html>/<body>. Also force-reveals the document (globals.css hides <html> until
 * hub-nav.js reveals it; if the crash happened before reveal, un-hide here so the
 * error is visible instead of a white screen).
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html style={{ visibility: "visible" }}>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b1120", color: "#e2e8f0", padding: 24 }}>
        <div style={{ maxWidth: 640, margin: "60px auto", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>ShadowData failed to load</h1>
          <p style={{ color: "#94a3b8", marginTop: 8, fontSize: 14 }}>{error?.message || "Unexpected error."}</p>
          <button
            onClick={reset}
            style={{ marginTop: 20, background: "#6366f1", color: "#fff", border: 0, borderRadius: 8, padding: "10px 20px", fontSize: 14 }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
