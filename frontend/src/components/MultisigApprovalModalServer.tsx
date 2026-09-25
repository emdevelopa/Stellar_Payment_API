import { Suspense } from "react";
import MultisigApprovalModal from "./MultisigApprovalModal.lazy";

interface MultisigApprovalModalServerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly networkPassphrase: string;
  readonly transaction?: any;
}

/**
 * Server Component wrapper for Multi-Signature Approval Modal
 * Issue: Migrate component to React Server Components for Multi-sig Approval Modal
 *
 * This server component wrapper provides:
 * - A server-rendered Suspense boundary around the client-only modal
 * - Optimized bundle size (the interactive modal stays code-split via
 *   MultisigApprovalModal.lazy, see Issue #1144)
 * - Streaming-friendly fallback while the client chunk hydrates
 */
export default async function MultisigApprovalModalServer(
  props: MultisigApprovalModalServerProps,
) {
  if (!props.isOpen) {
    return null;
  }

  return (
    <Suspense fallback={<MultisigApprovalModalFallback />}>
      <MultisigApprovalModal {...props} />
    </Suspense>
  );
}

function MultisigApprovalModalFallback() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-[#050608] p-6">
        <div className="flex items-center justify-center py-12">
          <div className="space-y-4 text-center">
            <div className="w-12 h-12 border-2 border-mint/30 border-t-mint rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-400">Loading approval modal...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export metadata for SEO
export const metadata = {
  title: "Multi-Signature Approval",
  description: "Review and approve multi-signature Stellar transactions",
};
