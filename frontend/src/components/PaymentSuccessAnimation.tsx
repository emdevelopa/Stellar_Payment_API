/**
 * PaymentSuccessAnimation — Server Component boundary
 *
 * The animation itself (framer-motion transitions, canvas-confetti, focus
 * trap, timers) is inherently interactive and lives in
 * PaymentSuccessAnimationClient ("use client"). This wrapper carries no
 * client directive, so it can be rendered from a Server Component without
 * pulling the animation/confetti bundle into the server render.
 *
 * next/dynamic with ssr:false code-splits the client bundle out of the
 * initial checkout chunk and streams PaymentSuccessSkeleton while it loads,
 * matching the KycFormShell/KycFormSkeleton pattern used elsewhere.
 */

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
  if (!props.show) return null;
  return <PaymentSuccessAnimationClient {...props} />;
}

export default PaymentSuccessAnimation;
