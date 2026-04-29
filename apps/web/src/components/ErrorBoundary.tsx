"use client";

/**
 * Issue #347 — Reports page (and other dashboard pages) were crashing the
 * entire client when a single render-time `TypeError` bubbled up from a
 * defensive-coercion miss. React, by default, will unmount the whole tree
 * on an uncaught render error which produces an empty white page with no
 * recovery UI.
 *
 * `ErrorBoundary` catches the throw at the page boundary, logs it, and
 * shows a small in-DOM fallback panel (NOT a native dialog) with a
 * `data-testid` hook so the bug-fix test for #347 can assert that the page
 * stays mounted.
 */
import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  testId?: string;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err ?? "Unknown error"),
    };
  }

  componentDidCatch(err: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
  }

  reset = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
          role="alert"
          data-testid={this.props.testId ?? "error-boundary"}
        >
          <p className="font-semibold">Something went wrong rendering this view.</p>
          <p className="mt-1 text-xs opacity-80">
            {this.state.message ?? "Unknown error"}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            data-testid="error-boundary-retry"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
