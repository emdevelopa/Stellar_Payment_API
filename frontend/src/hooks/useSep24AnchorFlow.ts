"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/** Stable toast id so repeated failures replace each other instead of stacking. */
export const SEP24_ERROR_TOAST_ID = "sep24-flow-error";

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

  // Mirrors the committed state so a failed attempt can roll back to it.
  const committedRef = useRef<{ step: Sep24FlowStep; url: string | null }>({
    step: "IDLE",
    url: null,
  });

  const isBusy = step === "CONNECTING" || step === "AUTH" || step === "SUBMITTING";

  const reset = useCallback(() => {
    committedRef.current = { step: "IDLE", url: null };
    setStep("IDLE");
    setInteractiveUrl(null);
  }, []);

  const start = useCallback(
    async ({ anchorDomain, assetCode, direction, amount }: StartSep24FlowParams) => {
      const previous = committedRef.current;
      try {
        // Load the Stellar SDK and wallet bridge only when a flow starts so
        // they stay out of the modal's initial bundle.
        const [stellar, freighter] = await Promise.all([
          import("@/lib/stellar"),
          import("@/lib/freighter"),
        ]);

        setStep("CONNECTING");
        const publicKey = await freighter.getFreighterPublicKey();
        const services = await stellar.getAnchorServices(anchorDomain);

        if (!services.webAuthEndpoint || !services.transferServer) {
          throw new Error("Anchor does not support SEP-0024 or SEP-0010");
        }

        setStep("AUTH");
        const jwt = await stellar.authenticateWithAnchor(
          publicKey,
          services.webAuthEndpoint,
          async (xdr) => {
            const res = await freighter.signWithFreighter(xdr, networkPassphrase);
            return res.signedXDR;
          },
        );

        setStep("SUBMITTING");
        const url =
          direction === "deposit"
            ? await stellar.initiateDeposit(services.transferServer, jwt, assetCode, publicKey, amount)
            : await stellar.initiateWithdrawal(services.transferServer, jwt, assetCode, publicKey);

        committedRef.current = { step: "READY", url };
        setInteractiveUrl(url);
        setStep("READY");
        return url;
      } catch (err) {
        // Roll the optimistic CONNECTING/AUTH/SUBMITTING progress back to the
        // last committed state and tell the user why.
        setStep(previous.step);
        setInteractiveUrl(previous.url);
        toast.error(err instanceof Error ? err.message : "Anchor request failed", {
          id: SEP24_ERROR_TOAST_ID,
        });
        throw err;
      }
    },
    [networkPassphrase],
  );

  return { step, isBusy, interactiveUrl, start, reset };
}
