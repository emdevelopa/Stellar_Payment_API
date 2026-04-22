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
    filename: "api-guide.mdx",
  },
  {
    slug: "hmac-signatures",
    title: "How to verify HMAC signatures",
    description:
      "Validate Stellar webhook requests using the exact HMAC-SHA256 scheme implemented in the backend.",
    filename: "hmac-signatures.mdx",
  },
  {
    slug: "x402-agentic-payments",
    title: "x402 Agentic Payments",
    description:
      "Use x402 as pay-per-request pricing for charged endpoints with your merchant account and API key.",
    filename: "x402-agentic-payments.mdx",
  },
];
