export type PaletteAction = "converter" | "copy-api-key" | "toggle-theme";

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  href?: string;
  action?: PaletteAction;
  keywords: string[];
}

export const paletteCommands: PaletteCommand[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "View payments, metrics and activity",
    href: "/dashboard",
    keywords: ["dashboard", "home", "overview", "payments", "activity"],
  },
  {
    id: "settings",
    label: "Settings",
    description: "Manage merchant profile, branding and webhooks",
    href: "/settings",
    keywords: ["settings", "config", "merchant", "profile", "webhooks"],
  },
  {
    id: "docs",
    label: "Docs",
    description: "Browse integration guides and help topics",
    href: "/docs",
    keywords: ["docs", "documentation", "help", "guides", "tutorials"],
  },
  {
    id: "create-new-payment",
    label: "Create New Payment",
    description: "Generate a new payment link",
    href: "/dashboard/create",
    keywords: ["create", "payment", "new", "link", "pay", "invoice"],
  },
  {
    id: "copy-api-key",
    label: "Copy API Key",
    description: "Copy the current merchant API key to clipboard",
    action: "copy-api-key",
    keywords: ["copy", "api", "key", "token", "clipboard", "secret"],
  },
  {
    id: "toggle-theme",
    label: "Toggle Theme",
    description: "Cycle between light, dark and system modes",
    action: "toggle-theme",
    keywords: ["toggle", "theme", "appearance", "dark", "light", "system"],
  },
  {
    id: "api-keys",
    label: "API Keys",
    description: "Open API key management settings",
    href: "/settings#api-keys",
    keywords: ["api", "keys", "rotate", "secret", "token"],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    description: "Configure webhook URL and inspect delivery logs",
    href: "/settings#webhooks",
    keywords: ["webhook", "webhooks", "delivery", "logs", "endpoint"],
  },
  {
    id: "payment-history",
    label: "Payment History",
    description: "Review recent and historical payment records",
    href: "/payment-history",
    keywords: ["history", "payments", "transactions", "records", "list"],
  },
  {
    id: "help-api-guide",
    label: "Help: Subscription API Guide",
    description: "Merchant integration guide for API key workflows",
    href: "/docs/api-guide",
    keywords: ["help", "docs", "api", "guide", "subscription", "integration"],
  },
  {
    id: "help-hmac-signatures",
    label: "Help: Verify HMAC Signatures",
    description: "Validate webhook signatures correctly",
    href: "/docs/hmac-signatures",
    keywords: ["help", "docs", "hmac", "signatures", "webhook", "security"],
  },
  {
    id: "help-x402-agentic-payments",
    label: "Help: x402 Agentic Payments",
    description: "Set up pay-per-request pricing for agents",
    href: "/docs/x402-agentic-payments",
    keywords: ["help", "docs", "x402", "agentic", "payments", "pricing"],
  },
  {
    id: "asset-converter",
    label: "Asset Converter",
    description: "Look up Stellar conversion rates quickly",
    action: "converter",
    keywords: ["convert", "converter", "rates", "exchange", "xlm", "usdc", "asset"],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function singleFieldScore(target: string, token: string): number {
  if (!target || !token) return 0;

  const exactIndex = target.indexOf(token);
  if (exactIndex >= 0) {
    const startsAtWord = exactIndex === 0 || " -_/".includes(target[exactIndex - 1]);
    const exactBonus = startsAtWord ? 4 : 2;
    return exactBonus + token.length / Math.max(target.length, 1);
  }

  let searchIndex = 0;
  let previousIndex = -2;
  let score = 0;

  for (const character of token) {
    const foundIndex = target.indexOf(character, searchIndex);
    if (foundIndex === -1) return 0;

    score += 1;
    if (foundIndex === 0 || " -_/".includes(target[foundIndex - 1])) {
      score += 0.7;
    }
    if (foundIndex === previousIndex + 1) {
      score += 0.6;
    }

    previousIndex = foundIndex;
    searchIndex = foundIndex + 1;
  }

  return score / (target.length + 1);
}

function commandScore(command: PaletteCommand, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields = [
    { value: command.label, weight: 3 },
    { value: command.description, weight: 1.8 },
    ...command.keywords.map((keyword) => ({ value: keyword, weight: 2.3 })),
  ];

  let score = 0;

  for (const token of tokens) {
    let bestTokenScore = 0;

    for (const field of fields) {
      const fieldValue = normalize(field.value);
      const fieldScore = singleFieldScore(fieldValue, token) * field.weight;
      if (fieldScore > bestTokenScore) {
        bestTokenScore = fieldScore;
      }
    }

    if (bestTokenScore <= 0) return 0;
    score += bestTokenScore;
  }

  const normalizedLabel = normalize(command.label);
  if (normalizedLabel === normalizedQuery) {
    score += 15;
  } else if (normalizedLabel.startsWith(normalizedQuery)) {
    score += 6;
  }

  return score;
}

export function filterPaletteCommands(
  query: string,
  commands: PaletteCommand[] = paletteCommands,
): PaletteCommand[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [...commands];

  return commands
    .map((command) => ({
      command,
      score: commandScore(command, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.command.label.localeCompare(right.command.label))
    .map((entry) => entry.command);
}

