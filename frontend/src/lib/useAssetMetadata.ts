"use client";

import { useEffect, useState } from "react";
import type { AssetMetadata, AssetMetadataResponse } from "@/app/api/asset-metadata/route";

export type { AssetMetadata };

// Static defaults — logo is null until the route resolves a real URL from stellar.toml.
const DEFAULT_ASSETS: AssetMetadata[] = [
  {
    code: "XLM",
    issuer: null,
    name: "Stellar Lumens",
    logo: null,
    description: "The native asset of the Stellar network",
  },
  {
    code: "USDC",
    issuer:
      process.env.NEXT_PUBLIC_USDC_ISSUER ??
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    name: "USD Coin",
    logo: null,
    description: "USD-backed stablecoin",
  },
];

export function useAssetMetadata(): { assets: AssetMetadata[] } {
  const [assets, setAssets] = useState<AssetMetadata[]>(DEFAULT_ASSETS);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/asset-metadata")
      .then((res) => {
        if (!res.ok) return;
        return res.json() as Promise<AssetMetadataResponse>;
      })
      .then((data) => {
        if (!cancelled && data) setAssets(data.assets);
      })
      .catch(() => {

      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { assets };
}
