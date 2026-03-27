"use client";

import DevTools from "@/components/DevTools";

export default function DevToolsPage() {
  return (
    <div className="flex flex-col gap-10 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold text-white">API Dev Tools</h1>
        <p className="max-w-2xl text-slate-400">
          Built-in GUI for testing API endpoints faster than Postman. Edit JSON requests and view syntax-highlighted responses.
        </p>
      </header>
      <DevTools />
    </div>
  );
}
