export interface DocSection {
  id: string;
  title: string;
}

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  filename: string;
  sections?: DocSection[];
}

export const docsManifest: DocEntry[] = [
  {
    slug: "api-guide",
    title: "Subscription API Guide",
    description:
      "Traditional merchant integration: register, use API keys, create payment links, and manage lifecycle/webhooks.",
    filename: "api-guide.mdx",
    sections: [
      { id: "integration-architecture", title: "Integration architecture" },
      { id: "your-backend-env", title: "Backend environment" },
      { id: "step-by-step-implementation", title: "Step-by-step implementation" },
      { id: "common-mistakes", title: "Common mistakes" },
    ],
  },
  {
    slug: "hmac-signatures",
    title: "How to verify HMAC signatures",
    description:
      "Validate Stellar webhook requests using the exact HMAC-SHA256 scheme implemented in the backend.",
    filename: "hmac-signatures.mdx",
    sections: [
      { id: "header-format", title: "Header format" },
      { id: "signing-logic-used-by-the-backend", title: "Signing logic" },
      { id: "framework-examples", title: "Framework examples" },
      { id: "retry-behavior", title: "Retry behavior" },
      { id: "checklist", title: "Checklist" },
    ],
  },
  {
    slug: "x402-agentic-payments",
    title: "x402 Agentic Payments",
    description:
      "Use x402 as pay-per-request pricing for charged endpoints with your merchant account and API key.",
    filename: "x402-agentic-payments.mdx",
    sections: [
      { id: "integration-architecture", title: "Integration architecture" },
      { id: "your-backend-env", title: "Backend environment" },
      { id: "x402-flow-in-one-view", title: "x402 flow in one view" },
      { id: "production-payonstellar-sample", title: "Production payOnStellar" },
      { id: "store-backend-checkout-route", title: "Checkout route" },
      { id: "practical-notes", title: "Practical notes" },
    ],
  },
];
