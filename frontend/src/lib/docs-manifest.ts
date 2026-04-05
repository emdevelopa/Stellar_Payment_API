export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  filename: string;
}

export const docsManifest: DocEntry[] = [
  {
    slug: "api-guide",
    title: "Subscription API Guide",
    description:
      "Traditional merchant integration: register, use API keys, create payment links, and manage lifecycle/webhooks.",
    filename: "api-guide.md",
  },
  {
    slug: "hmac-signatures",
    title: "How to verify HMAC signatures",
    description:
      "Validate Stellar webhook requests using the exact HMAC-SHA256 scheme implemented in the backend.",
    filename: "hmac-signatures.md",
  },
  {
    slug: "x402-agentic-payments",
    title: "x402 Agentic Payments",
    description:
      "Let AI agents and developer tools pay per API call using USDC micropayments on Stellar. No subscriptions, no API keys — just crypto.",
    filename: "x402-agentic-payments.mdx",
  },
];
