/**
 * Lazy-loaded MultisigApprovalModal
 * Issue #1144: Optimize client-side bundle size for Multi-sig Approval Modal
 *
 * This module provides dynamic imports for the MultisigApprovalModal component
 * to reduce the initial bundle size. The modal is code-split and only loaded
 * when needed.
 */

"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

interface MultisigApprovalModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly networkPassphrase: string;
  readonly transaction?: any;
}

const MultisigApprovalModalComponent = dynamic(
  () => import("./MultisigApprovalModal"),
  {
    loading: () => (
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
    ),
    ssr: false,
  }
) as ComponentType<MultisigApprovalModalProps>;

export default MultisigApprovalModalComponent;
