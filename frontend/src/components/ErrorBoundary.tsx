"use client";

import { Component, ErrorInfo, ReactNode } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorId: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    
    // Capture error with Sentry and get the event ID
    const errorId = Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
      tags: {
        errorBoundary: true,
        component: "ErrorBoundary",
      },
      extra: {
        errorInfo: {
          componentStack: errorInfo.componentStack,
          errorBoundary: true,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          url: window.location.href,
        },
      },
    });

    // Store the error ID for user reference
    this.setState({ errorId });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
          <div className="flex flex-col items-center gap-8 max-w-md">
            {/* Error Illustration */}
            <div className="relative w-64 h-64">
              <svg
                viewBox="0 0 200 200"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full text-red-400"
              >
                <circle cx="100" cy="100" r="50" fill="currentColor" fillOpacity="0.2" />
                <circle cx="100" cy="100" r="30" fill="currentColor" />
                <g className="animate-pulse">
                  <path
                    d="M100 20L100 50M100 150L100 180M20 100L50 100M150 100L180 100"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M43.4 43.4L64.6 64.6M135.4 135.4L156.6 156.6M43.4 156.6L64.6 135.4M135.4 43.4L156.6 64.6"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </g>
                <path
                  d="M80 80L120 120M120 80L80 120"
                  stroke="white"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-red-500/10 blur-3xl rounded-full" />
            </div>

            <div className="flex flex-col gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-red-400">
                Something Went Wrong
              </p>
              <h1 className="text-3xl font-bold text-white sm:text-4xl">
                Houston, we have a problem.
              </h1>
              <p className="text-slate-400">
                An unexpected error occurred while rendering this page. Please try again or return to the dashboard.
              </p>
              
              {this.state.errorId && (
                <div className="mt-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
                  <p className="text-xs text-red-400 mb-2">Error Reference ID:</p>
                  <code className="text-sm font-mono text-red-300 break-all">
                    {this.state.errorId}
                  </code>
                  <p className="text-xs text-slate-500 mt-2">
                    This error has been automatically reported to our development team.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={this.handleReset}
                className="group relative flex items-center justify-center gap-2 rounded-full border border-mint/30 bg-mint/5 px-8 py-3 text-sm font-semibold text-mint backdrop-blur transition-all hover:bg-mint/10"
              >
                Try Again
                <div className="absolute inset-0 -z-10 bg-mint/10 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
              </button>

              <Link
                href="/"
                className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-8 py-3 text-sm font-semibold text-white backdrop-blur transition-all hover:bg-white/10"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
