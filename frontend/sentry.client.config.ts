import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Performance monitoring
  tracesSampleRate: 1.0,
  // Session replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  // Environment
  environment: process.env.NODE_ENV,
  // Release version
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.npm_package_version,
  // Debug mode in development
  debug: process.env.NODE_ENV === "development",
  // beforeSend filter to avoid sending sensitive data
  beforeSend(event) {
    // Filter out any potentially sensitive data
    if (event.exception) {
      event.exception.values?.forEach((exception) => {
        if (exception.stacktrace) {
          exception.stacktrace.frames = exception.stacktrace.frames?.map((frame) => ({
            ...frame,
            // Remove any query parameters from URLs
            filename: frame.filename?.split('?')[0],
          }));
        }
      });
    }
    return event;
  },
  // Capture context for better debugging
  beforeSendTransaction(transaction) {
    // Add custom context to transactions
    transaction.tags = {
      ...transaction.tags,
      component: "frontend"
    };
    return transaction;
  },
});
