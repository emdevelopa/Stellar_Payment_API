"use client";

import { useCallback, useState } from "react";
import {
  getAnchorServices,
  authenticateWithAnchor,
  initiateDeposit,
  initiateWithdrawal,
} from "@/lib/stellar";
import { signWithFreighter, getFreighterPublicKey } from "@/lib/freighter";

export type Sep24FlowStep = "IDLE" | "CONNECTING" | "AUTH" | "SUBMITTING" | "READY";
export type Sep24BusyStep = Extract<Sep24FlowStep, "CONNECTING" | "AUTH" | "SUBMITTING">;
export type Sep24Direction = "deposit" | "withdraw";

interface UseSep24AnchorFlowOptions {
  networkPassphrase: string;
}

interface StartSep24FlowParams {
  anchorDomain: string;
  assetCode: string;
  direction: Sep24Direction;
  /** Only used for deposits — anchors don't accept a pre-filled amount on withdrawal. */
  amount?: string;
}

/**
 * Drives a SEP-0024 hosted interactive flow end to end: SEP-0001 anchor
 * discovery, SEP-0010 wallet-signed auth, then a SEP-0024 deposit or
 * withdrawal request for the interactive URL. Shared by the deposit
 * (FiatOnrampModal) and withdrawal (WithdrawalModal) flows, which were
 * previously two near-identical copies of this same sequence.
 */
export function useSep24AnchorFlow({ networkPassphrase }: UseSep24AnchorFlowOptions) {
  const [step, setStep] = useState<Sep24FlowStep>("IDLE");
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);

  const isBusy = step === "CONNECTING" || step === "AUTH" || step === "SUBMITTING";

  const reset = useCallback(() => {
    setStep("IDLE");
    setInteractiveUrl(null);
  }, []);

  const start = useCallback(
    async ({ anchorDomain, assetCode, direction, amount }: StartSep24FlowParams) => {
      try {
        setStep("CONNECTING");
        const publicKey = await getFreighterPublicKey();
        const services = await getAnchorServices(anchorDomain);

        if (!services.webAuthEndpoint || !services.transferServer) {
          throw new Error("Anchor does not support SEP-0024 or SEP-0010");
        }

        setStep("AUTH");
        const jwt = await authenticateWithAnchor(
          publicKey,
          services.webAuthEndpoint,
          async (xdr) => {
            const res = await signWithFreighter(xdr, networkPassphrase);
            return res.signedXDR;
          },
        );

        setStep("SUBMITTING");
        const url =
          direction === "deposit"
            ? await initiateDeposit(services.transferServer, jwt, assetCode, publicKey, amount)
            : await initiateWithdrawal(services.transferServer, jwt, assetCode, publicKey);

        setInteractiveUrl(url);
        setStep("READY");
        return url;
      } catch (err) {
        setStep("IDLE");
        throw err;
      }
    },
    [networkPassphrase],
  );

  return { step, isBusy, interactiveUrl, start, reset };
}
