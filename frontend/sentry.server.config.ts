import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Performance monitoring
  tracesSampleRate: 1.0,
  // Environment
  environment: process.env.NODE_ENV,
  // Release version
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.npm_package_version,
  // Debug mode in development
  debug: process.env.NODE_ENV === "development",
  // beforeSend filter for server-side
  beforeSend(event) {
    // Filter out sensitive server data
    if (event.request) {
      // Remove sensitive headers
      if (event.request.headers) {
        const { authorization: _, cookie: __, ...safeHeaders } = event.request.headers;
        event.request.headers = safeHeaders;
      }
    }
    return event;
  },
});
