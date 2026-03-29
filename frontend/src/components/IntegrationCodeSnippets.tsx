"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import CopyButton from "./CopyButton";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface IntegrationCodeSnippetsProps {
  apiKey: string;
  amount: string;
  asset: "XLM" | "USDC";
  recipient: string;
  description: string;
  usdcIssuer: string;
}

type Language = "curl" | "node" | "python";

const LANGUAGES: { id: Language; label: string; grammar: string }[] = [
  { id: "curl", label: "cURL", grammar: "bash" },
  { id: "node", label: "Node.js", grammar: "javascript" },
  { id: "python", label: "Python", grammar: "python" },
];

function generateSnippet(
  lang: Language,
  apiKey: string,
  amount: string,
  asset: "XLM" | "USDC",
  recipient: string,
  description: string,
  usdcIssuer: string,
): string {
  const numAmount = parseFloat(amount) || 0;
  const safeRecipient =
    recipient || "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const safeDescription = description || "Payment for services";

  const body: Record<string, unknown> = {
    amount: numAmount,
    asset,
    recipient: safeRecipient,
  };
  if (asset === "USDC") body.asset_issuer = usdcIssuer;
  if (description) body.description = safeDescription;

  const jsonBody = JSON.stringify(body, null, 2);

  switch (lang) {
    case "curl":
      return `curl -X POST "${API_URL}/api/create-payment" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey}" \\
  -d '${jsonBody}'`;

    case "node":
      return `const response = await fetch("${API_URL}/api/create-payment", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${apiKey}",
  },
  body: JSON.stringify(${jsonBody}),
});

const data = await response.json();
console.log(data.payment_link);`;

    case "python":
      return `import requests

response = requests.post(
    "${API_URL}/api/create-payment",
    headers={
        "Content-Type": "application/json",
        "x-api-key": "${apiKey}",
    },
    json=${jsonBody},
)

data = response.json()
print(data["payment_link"])`;
  }
}

export default function IntegrationCodeSnippets({
  apiKey,
  amount,
  asset,
  recipient,
  description,
  usdcIssuer,
}: IntegrationCodeSnippetsProps) {
  const t = useTranslations("createPaymentForm");
  const [activeTab, setActiveTab] = useState<Language>("curl");
  const codeRef = useRef<HTMLElement>(null);

  const snippet = useMemo(
    () => generateSnippet(activeTab, apiKey, amount, asset, recipient, description, usdcIssuer),
    [activeTab, apiKey, amount, asset, recipient, description, usdcIssuer],
  );

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [snippet, activeTab]);

  const grammarMap: Record<Language, string> = {
    curl: "bash",
    node: "javascript",
    python: "python",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.id}
            type="button"
            onClick={() => setActiveTab(lang.id)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              activeTab === lang.id
                ? "text-black"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {activeTab === lang.id && (
              <motion.div
                layoutId="snippet-tab-bg"
                className="absolute inset-0 rounded-lg bg-mint"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10">{lang.label}</span>
          </button>
        ))}
      </div>

      {/* Code block */}
      <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-[rgba(2,6,23,0.82)]">
        {/* Copy button */}
        <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={snippet} />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="overflow-x-auto p-4"
          >
            <pre className="!m-0 !bg-transparent !p-0">
              <code
                ref={codeRef}
                className={`language-${grammarMap[activeTab]} !bg-transparent`}
              >
                {snippet}
              </code>
            </pre>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Helper text */}
      <p className="text-xs text-slate-500">
        {t("snippetsHelper")}
      </p>
    </div>
  );
}
