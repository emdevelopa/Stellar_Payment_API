"use client";

import { useState } from "react";
import { useMerchantApiKey } from "@/lib/merchant-store";

// Helper to colorize JSON output
function highlightJson(jsonString: string): string {
  if (!jsonString) return "";
  const entityMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;"
  };
  const escaped = jsonString.replace(/[&<>"'\/]/g, (s) => entityMap[s]);
  
  // Basic Regex for JSON tokenization (strings, numbers, booleans, nulls, keys)
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-yellow-400"; // number
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "text-purple-400 font-semibold"; // key
        } else {
          cls = "text-green-400"; // string
        }
      } else if (/true|false/.test(match)) {
        cls = "text-blue-400"; // boolean
      } else if (/null/.test(match)) {
        cls = "text-slate-500 italic"; // null
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

export default function DevTools() {
  const storedApiKey = useMerchantApiKey();
  const [method, setMethod] = useState("GET");
  const [endpoint, setEndpoint] = useState("/api/payments");
  const [apiKey, setApiKey] = useState(storedApiKey || "");
  const [requestBody, setRequestBody] = useState("{\n  \n}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  
  const [isRunning, setIsRunning] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<string>("");

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(requestBody);
      setRequestBody(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (err: any) {
      setJsonError(err.message || "Invalid JSON");
    }
  };

  const handleRun = async () => {
    setJsonError(null);
    setIsRunning(true);
    setResponseStatus(null);
    setResponseBody("");

    try {
      let bodyData = undefined;
      // Only attach body if not GET or DELETE
      if (method !== "GET" && method !== "DELETE") {
        try {
          if (requestBody.trim() !== "") {
            JSON.parse(requestBody);
            bodyData = requestBody;
          }
        } catch (err: any) {
          throw new Error(`Invalid JSON body: ${err.message}`);
        }
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey.trim()) {
        headers["x-api-key"] = apiKey.trim();
      }

      // Automatically construct valid endpoint using BASE API if it's relative
      const url = endpoint.startsWith("http") 
        ? endpoint 
        : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

      const startedAt = performance.now();
      const res = await fetch(url, {
        method,
        headers,
        body: bodyData,
      });
      const finishedAt = performance.now();

      const text = await res.text();
      let formattedBody = text;
      try {
        const parsed = JSON.parse(text);
        formattedBody = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep plain text if parsing fails (e.g. 404 HTML)
      }

      setResponseStatus(res.status);
      setResponseTime(Math.round(finishedAt - startedAt));
      setResponseBody(formattedBody);

    } catch (error: any) {
      setResponseStatus(0);
      setResponseBody(error.message || "Request failed to send. Check network or CORS.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Request Panel */}
      <div className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Request Context</h2>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="rounded-lg bg-mint px-6 py-2 text-sm font-bold text-black shadow-[0_0_15px_rgba(45,212,191,0.3)] transition-all hover:bg-mint/90 hover:shadow-[0_0_25px_rgba(45,212,191,0.5)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? "Sending..." : "Send Request"}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full sm:w-32 rounded-xl border border-white/10 bg-black/50 px-3 py-3 text-sm font-semibold text-mint outline-none focus:border-mint/50 focus:ring-1 focus:ring-mint/50 cursor-pointer"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.example.com/v1/resource or /api/endpoint"
              className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-sm text-white placeholder-slate-600 outline-none focus:border-mint/50 focus:ring-1 focus:ring-mint/50 w-full"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
              API Key (Authorization)
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_test_..."
              className="rounded-xl border border-white/10 bg-black/50 px-4 py-3 font-mono text-sm text-white placeholder-slate-600 outline-none focus:border-mint/50 focus:ring-1 focus:ring-mint/50"
            />
          </div>

          <div className="flex flex-col gap-1.5 flex-1 min-h-[300px]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                JSON Body
              </label>
              <button 
                onClick={handleFormat}
                className="text-xs font-semibold text-mint hover:underline"
              >
                Format Request JSON
              </button>
            </div>
            {/* Editor Area */}
            <div className="group relative flex-1 min-h-[250px] rounded-xl border border-white/10 bg-black/50 overflow-hidden focus-within:border-mint/50 focus-within:ring-1 focus-within:ring-mint/50">
              <textarea
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                spellCheck={false}
                placeholder="Enter valid JSON here..."
                className="absolute inset-0 w-full h-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
              />
            </div>
            {jsonError && <p className="text-xs text-red-400 mt-1">{jsonError}</p>}
          </div>
        </div>
      </div>

      {/* Response Panel */}
      <div className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Server Response</h2>
          {responseStatus !== null && (
            <div className="flex items-center gap-4 text-sm">
              <span className={`font-mono font-bold ${responseStatus >= 200 && responseStatus < 300 ? 'text-green-400' : 'text-red-400'}`}>
                {responseStatus === 0 ? "ERROR" : `Status: ${responseStatus}`}
              </span>
              {responseTime !== null && (
                <span className="font-mono text-slate-400">
                  {responseTime}ms
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="relative flex-1 rounded-xl border border-white/10 bg-[#0d1017] shadow-inner overflow-hidden flex min-h-[400px]">
          {responseBody ? (
            <pre 
              className="absolute inset-0 w-full h-full overflow-auto p-4 font-mono text-sm leading-relaxed pointer-events-auto select-auto focus:outline-none"
              dangerouslySetInnerHTML={{ __html: highlightJson(responseBody) }}
            />
          ) : (
            <div className="m-auto flex flex-col items-center justify-center text-slate-600 gap-3">
              <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <p className="text-sm font-medium">Awaiting Execution...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
