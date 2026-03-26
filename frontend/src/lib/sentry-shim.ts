type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

type CaptureContext = Record<string, unknown>;

type Breadcrumb = {
  message?: string;
  category?: string;
  level?: SentryLevel;
  timestamp?: number;
};

type User = {
  id?: string;
  email?: string;
  username?: string;
} | null;

export function withSentryConfig(config: unknown) {
  return config;
}

export function init() {}

export function captureException(error: unknown, context?: CaptureContext) {
  void error;
  void context;
  return undefined;
}

export function captureMessage(message: string, context?: CaptureContext) {
  void message;
  void context;
  return undefined;
}

export function setUser(user: User) {
  void user;
}

export function addBreadcrumb(breadcrumb: Breadcrumb) {
  void breadcrumb;
}
