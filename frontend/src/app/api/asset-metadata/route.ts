import { NextResponse } from "next/server";

// ISR: revalidate at most once per hour.
 
export const revalidate = 3600;

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ??
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export interface AssetMetadata {
  code: string;
  issuer: string | null;
  name: string;
  logo: string | null;
  description: string;
}

export interface AssetMetadataResponse {
  assets: AssetMetadata[];
  cached_at: string;
}

function parseCurrency(
  tomlText: string,
  code: string,
  issuer?: string,
): { name?: string; image?: string } {
  const blocks = tomlText.split(/\[\[CURRENCIES\]\]/i).slice(1);

  for (const block of blocks) {
    const end = block.search(/^\s*\[/m);
    const section = end > -1 ? block.slice(0, end) : block;

    const getField = (key: string) =>
      section.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];

    if (getField("code") !== code) continue;
    if (issuer && getField("issuer") !== issuer) continue;

    return { name: getField("name"), image: getField("image") };
  }

  return {};
}

async function getHomeDomain(code: string, issuer: string): Promise<string | null> {
  const res = await fetch(
    `${HORIZON_URL}/assets?asset_code=${code}&asset_issuer=${encodeURIComponent(issuer)}&limit=1`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data._embedded?.records?.[0]?.home_domain ?? null;
}

async function getTomlMetadata(
  homeDomain: string,
  code: string,
  issuer?: string,
): Promise<{ name?: string; logo?: string }> {
  const res = await fetch(
    `https://${homeDomain}/.well-known/stellar.toml`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return {};
  const text = await res.text();
  const { name, image } = parseCurrency(text, code, issuer);
  return { name, logo: image };
}

export async function GET() {
  // XLM is the native asset — no Horizon asset record or stellar.toml needed.
  const xlm: AssetMetadata = {
    code: "XLM",
    issuer: null,
    name: "Stellar Lumens",
    logo: null,
    description: "The native asset of the Stellar network",
  };

  // USDC — resolve real name and logo via Horizon → home_domain → stellar.toml.
  let usdc: AssetMetadata = {
    code: "USDC",
    issuer: USDC_ISSUER,
    name: "USD Coin",
    logo: null,
    description: "USD-backed stablecoin",
  };

  try {
    const homeDomain = await getHomeDomain("USDC", USDC_ISSUER);
    if (homeDomain) {
      const { name, logo } = await getTomlMetadata(homeDomain, "USDC", USDC_ISSUER);
      usdc = {
        ...usdc,
        ...(name && { name }),
        ...(logo && { logo }),
      };
    }
  } catch {
    // Network error — static fallback remains.
  }

  return NextResponse.json<AssetMetadataResponse>({
    assets: [xlm, usdc],
    cached_at: new Date().toISOString(),
  });
}
