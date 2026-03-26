import * as Sentry from "@sentry/nextjs";

interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  [key: string]: unknown;
}

export function useErrorReporting() {
  const reportError = (
    error: Error | string,
    context?: ErrorContext,
    level: "fatal" | "error" | "warning" | "info" | "debug" = "error"
  ) => {
    const errorObj = typeof error === "string" ? new Error(error) : error;
    
    const eventId = Sentry.captureException(errorObj, {
      level,
      tags: {
        component: context?.component || "Unknown",
        action: context?.action || "Unknown",
        customReport: true,
      },
      extra: {
        ...context,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "SSR",
        url: typeof window !== "undefined" ? window.location.href : "SSR",
      },
    });

    return eventId;
  };

  const reportMessage = (
    message: string,
    level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
    context?: ErrorContext
  ) => {
    const eventId = Sentry.captureMessage(message, {
      level,
      tags: {
        component: context?.component || "Unknown",
        action: context?.action || "Unknown",
        customMessage: true,
      },
      extra: {
        ...context,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "SSR",
        url: typeof window !== "undefined" ? window.location.href : "SSR",
      },
    });

    return eventId;
  };

  const setUser = (user: { id: string; email?: string; username?: string }) => {
    Sentry.setUser(user);
  };

  const clearUser = () => {
    Sentry.setUser(null);
  };

  const addBreadcrumb = (
    message: string,
    category: string = "user",
    level: "fatal" | "error" | "warning" | "info" | "debug" = "info"
  ) => {
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      timestamp: Date.now() / 1000,
    });
  };

  return {
    reportError,
    reportMessage,
    setUser,
    clearUser,
    addBreadcrumb,
  };
}
