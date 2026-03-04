/**
 * Sentry Instrumentation — Must be imported FIRST before any other modules.
 *
 * For ESM projects, this file should be loaded via:
 *   node --import ./dist/instrument.js ./dist/index.js
 *
 * This ensures Sentry can properly instrument Express, HTTP, and other modules.
 */

import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    release: `ttml-server@${process.env.VITE_APP_ID ?? "dev"}`,

    // Performance: sample 30% of transactions in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.3 : 1.0,

    // Integrations
    integrations: [
      // Automatically instrument Express
      Sentry.expressIntegration(),
      // HTTP integration for outgoing requests
      Sentry.httpIntegration(),
    ],

    // Before send hook — redact sensitive data
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        if (headers.authorization) headers.authorization = "[REDACTED]";
        if (headers.cookie) headers.cookie = "[REDACTED]";
        event.request.headers = headers;
      }
      return event;
    },

    // Ignore common non-actionable errors
    ignoreErrors: [
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "socket hang up",
    ],
  });

  console.log("[Sentry] Instrumentation initialized");
} else {
  console.log("[Sentry] No DSN configured — monitoring disabled");
}
