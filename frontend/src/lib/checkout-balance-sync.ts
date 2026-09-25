import type { AssetBalance } from "@/lib/stellar";

export function getBalanceAmount(
  balances: AssetBalance[],
  assetCode: string,
): number {
  const match = balances.find((balance) => balance.code === assetCode);
  const parsed = Number.parseFloat(match?.balance ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortSupportedAssetsByBalance(
  supportedAssets: string[],
  balances: AssetBalance[],
): string[] {
  return [...supportedAssets].sort((left, right) => {
    return getBalanceAmount(balances, right) - getBalanceAmount(balances, left);
  });
}

export function getDefaultSourceAsset(
  supportedAssets: string[],
  balances: AssetBalance[],
): string | null {
  const sorted = sortSupportedAssetsByBalance(supportedAssets, balances);
  return sorted[0] ?? null;
}

export function didWalletAccountSwitch(
  previousPublicKey: string | null,
  nextPublicKey: string | null,
): boolean {
  return Boolean(
    previousPublicKey &&
      nextPublicKey &&
      previousPublicKey !== nextPublicKey,
  );
}
