import { getTranslations } from "next-intl/server";

interface NetworkFeeData {
  network: string;
  horizon_url: string;
  operation_count: number;
  stroops: number;
  xlm: string;
  last_ledger_base_fee: number;
}

interface NetworkFeeEstimationServerProps {
  networkFee: NetworkFeeData | null;
  error?: string;
}

export async function NetworkFeeEstimationServer({ networkFee, error }: NetworkFeeEstimationServerProps) {
  const t = await getTranslations("checkout");

  return (
    <p className="mt-3 text-sm text-[#6B6B6B]">
      {networkFee ? (
        t("networkFeeLabel", { amount: networkFee.xlm })
      ) : (
        error ?? t("networkFeeUnavailable")
      )}
    </p>
  );
}
