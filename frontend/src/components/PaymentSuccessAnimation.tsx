"use client";

/**
 * PaymentSuccessAnimation — lazy-loading boundary
 *
 * The animation itself (framer-motion transitions, canvas-confetti, focus
 * trap, timers) lives in PaymentSuccessAnimationClient. next/dynamic with
 * ssr:false code-splits that client bundle out of the initial checkout
 * chunk and streams PaymentSuccessSkeleton while it loads, matching the
 * KycFormShell/KycFormSkeleton pattern used elsewhere.
 *
 * Once `show` has gone true, this wrapper keeps rendering the client
 * component even after `show` flips back to false. PaymentSuccessAnimationClient
 * runs its dialog through <AnimatePresence>, whose exit transition needs a
 * render tick with the dialog still mounted; bailing out to `null` here as
 * soon as `show` was false unmounted the whole subtree immediately and
 * skipped that exit animation entirely (#1390).
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import PaymentSuccessSkeleton from "@/components/PaymentSuccessSkeleton";
import type { PaymentSuccessAnimationProps } from "@/components/PaymentSuccessAnimationClient";

const PaymentSuccessAnimationClient = dynamic(
  () =>
    import("@/components/PaymentSuccessAnimationClient").then(
      (m) => m.PaymentSuccessAnimationClient
    ),
  {
    ssr: false,
    loading: () => <PaymentSuccessSkeleton />,
  }
);

export function PaymentSuccessAnimation(props: PaymentSuccessAnimationProps) {
  const [hasBeenShown, setHasBeenShown] = useState(props.show);

  useEffect(() => {
    if (props.show) setHasBeenShown(true);
  }, [props.show]);

  if (!hasBeenShown) return null;
  return <PaymentSuccessAnimationClient {...props} />;
}

export default PaymentSuccessAnimation;
