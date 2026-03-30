"use client";

import { useMemo, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { useMerchantApiKey } from "@/lib/merchant-store";
import ApiUsageChart from "@/components/ApiUsageChart";
import { InfoTooltip } from "@/components/InfoTooltip";

type SandboxExample = {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  requiresApiKey: boolean;
  description: string;
  body?: Record<string, unknown>;
};

const examples: SandboxExample[] = [
  {
    id: "health",
    label: "Health Check",
    method: "GET",
    path: "/health",
    requiresApiKey: false,
    description: "Checks API and upstream dependencies status.",
  },
  {
    id: "register",
    label: "Register Merchant",
    method: "POST",
    path: "/api/register-merchant",
    requiresApiKey: false,
    description: "Creates a merchant and returns API key + webhook secret.",
    body: {
      email: "merchant@example.com",
      business_name: "Stellar Shop",
      notification_email: "alerts@example.com",
    },
  },
  {
    id: "create-payment",
    label: "Create Payment",
    method: "POST",
    path: "/api/create-payment",
    requiresApiKey: true,
    description: "Creates a payment link for XLM or USDC collection.",
    body: {
      amount: 5,
      asset: "XLM",
      recipient: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA6LNFBQPA2WKGX4QNT6MBCQ4MMR",
      description: "Sandbox test payment",
    },
  },
  {
    id: "metrics",
    label: "7-Day Metrics",
    method: "GET",
    path: "/api/metrics/7day",
    requiresApiKey: true,
    description: "Fetches payment volume and count trend over 7 days.",
  },
  {
    id: "payments",
    label: "List Payments",
    method: "GET",
    path: "/api/payments?page=1&limit=5",
    requiresApiKey: true,
    description: "Returns recent payments with pagination metadata.",
  },
  {
    id: "rotate",
    label: "Rotate API Key",
    method: "POST",
    path: "/api/rotate-key",
    requiresApiKey: true,
    description: "Invalidates current key and returns a new API key.",
  },
];

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function DevSandbox() {
  const storedApiKey = useMerchantApiKey();
  const [apiBaseUrl, setApiBaseUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  );
  const [apiKey, setApiKey] = useState(storedApiKey ?? "");
  const [selectedId, setSelectedId] = useState(examples[0].id);
  const [bodyDraft, setBodyDraft] = useState(pretty(examples[0].body ?? {}));
  const [isRunning, setIsRunning] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<
    Record<string, string>
  >({});
  const [responseBody, setResponseBody] = useState<string>(
    "Run a request to see response output.",
  );
  const [runError, setRunError] = useState<string | null>(null);

  const selectedExample = useMemo(
    () => examples.find((example) => example.id === selectedId) ?? examples[0],
    [selectedId],
  );

  const fetchSnippet = useMemo(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (selectedExample.requiresApiKey) {
      headers["x-api-key"] = apiKey || "<your_api_key>";
    }

    const init: Record<string, unknown> = {
      method: selectedExample.method,
      headers,
    };

    if (selectedExample.method !== "GET") {
      init.body =
        bodyDraft.trim().length > 0
          ? `JSON.stringify(${bodyDraft.trim()})`
          : "JSON.stringify({})";
    }

    const initLines = Object.entries(init)
      .map(([key, value]) => {
        if (key === "headers") {
          return `  headers: ${pretty(value)},`;
        }
        if (key === "body" && typeof value === "string") {
          return `  body: ${value},`;
        }
        return `  ${key}: ${pretty(value)},`;
      })
      .join("\n");

    return `const res = await fetch("${apiBaseUrl}${selectedExample.path}", {\n${initLines}\n});\nconst data = await res.json();\nconsole.log(res.status, data);`;
  }, [apiBaseUrl, apiKey, bodyDraft, selectedExample]);

  const onExampleChange = (id: string) => {
    const next = examples.find((example) => example.id === id);
    setSelectedId(id);
    setRunError(null);
    if (next?.body) {
      setBodyDraft(pretty(next.body));
    } else {
      setBodyDraft("{}");
    }
  };

  const runRequest = async () => {
    setRunError(null);
    setIsRunning(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (selectedExample.requiresApiKey) {
        if (!apiKey.trim()) {
          throw new Error("This endpoint requires an x-api-key header.");
        }
        headers["x-api-key"] = apiKey.trim();
      }

      const init: RequestInit = {
        method: selectedExample.method,
        headers,
      };

      if (selectedExample.method !== "GET") {
        const parsed = bodyDraft.trim() ? JSON.parse(bodyDraft) : {};
        init.body = JSON.stringify(parsed);
      }

      const startedAt = performance.now();
      const res = await fetch(`${apiBaseUrl}${selectedExample.path}`, init);
      const finishedAt = performance.now();

      const headersObj = Object.fromEntries(res.headers.entries());
      const text = await res.text();

      let formattedBody = text;
      try {
        const parsed = JSON.parse(text);
        formattedBody = pretty(parsed);
      } catch {
        // Keep plain response text if it isn't JSON.
      }

      setResponseStatus(res.status);
      setResponseTime(Math.round(finishedAt - startedAt));
      setResponseHeaders(headersObj);
      setResponseBody(formattedBody || "<empty response>");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      setRunError(message);
      setResponseStatus(null);
      setResponseHeaders({});
      setResponseBody("No response body available due to request error.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-cyan-500/10 via-sky-500/5 to-transparent p-6 backdrop-blur">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">
          Dev Sandbox
        </p>
        <h2 className="text-xl font-semibold text-white">
          Test API Calls Without Leaving Dashboard
        </h2>
        <p className="text-sm text-slate-300">
          Select a predefined endpoint, run it live, and copy the fetch block
          for your app.
        </p>
      </div>

      <ApiUsageChart />

      <div className="grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4 lg:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wider text-slate-400">
          API Base URL
          <InfoTooltip
            className="normal-case"
            content={
              <span>
                Use your backend origin for local or deployed testing.
                <br />
                Example:
                <br />
                <code className="text-[11px] text-mint">
                  https://api.yourdomain.com
                </code>
              </span>
            }
          >
            <span tabIndex={0}>help</span>
          </InfoTooltip>
          <input
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm normal-case tracking-normal text-white focus:border-cyan-400/60 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs uppercase tracking-wider text-slate-400">
          API Key (Optional)
          <InfoTooltip
            className="normal-case"
            content={
              <span>
                Required for protected endpoints like create payment, metrics, and
                list payments.
              </span>
            }
          >
            <span tabIndex={0}>when needed</span>
          </InfoTooltip>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk_..."
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onExampleChange(example.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
              example.id === selectedExample.id
                ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25 hover:text-white"
            }`}
          >
            {example.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">
              {selectedExample.label}
            </p>
            <p className="text-xs text-slate-400">
              {selectedExample.description}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-slate-300">
            {selectedExample.method} {selectedExample.path}
          </div>
        </div>

        {selectedExample.method !== "GET" && (
          <div className="mb-4 flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Request Body (JSON)
            </label>
            <textarea
              value={bodyDraft}
              onChange={(event) => setBodyDraft(event.target.value)}
              rows={7}
              className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-slate-200 focus:border-cyan-400/60 focus:outline-none"
            />
          </div>
        )}

        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">
            Copyable Fetch Block
          </p>
          <CopyButton text={fetchSnippet} />
        </div>
        <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-3 text-xs leading-relaxed text-slate-200">
          <code>{fetchSnippet}</code>
        </pre>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runRequest}
            disabled={isRunning}
            className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunning ? "Running..." : "Run Request"}
          </button>
          {responseStatus !== null && (
            <p className="text-xs text-slate-400">
              Status:{" "}
              <span className="font-mono text-slate-200">{responseStatus}</span>
              {responseTime !== null ? (
                <>
                  {" "}
                  | Time:{" "}
                  <span className="font-mono text-slate-200">
                    {responseTime}ms
                  </span>
                </>
              ) : null}
            </p>
          )}
        </div>

        {runError && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {runError}
          </p>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-black/50 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
              Response Headers
            </p>
            <pre className="max-h-56 overflow-auto text-xs text-slate-300">
              <code>{pretty(responseHeaders)}</code>
            </pre>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/50 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
              Response Body
            </p>
            <pre className="max-h-56 overflow-auto text-xs text-slate-300">
              <code>{responseBody}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
