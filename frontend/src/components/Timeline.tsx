"use client";

import React, { useState, useCallback, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaymentLifecycleStatus =
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "refunded";

export type LifecycleStepStatus = "completed" | "current" | "pending" | "failed";

export interface LifecycleStepDetails {
  ledgerSequence?: number;
  txHash?: string;
  confirmations?: number;
  maxConfirmations?: number;
  fee?: string;
  memo?: string;
  sourceAccount?: string;
  destinationAccount?: string;
  asset?: string;
  amount?: string;
  errorMessage?: string;
  blockTime?: string;
}

export interface LifecycleStep {
  id: string;
  label: string;
  description?: string;
  status: LifecycleStepStatus;
  timestamp?: string;
  details?: LifecycleStepDetails;
}

export interface PaymentLifecycleData {
  id: string;
  status: PaymentLifecycleStatus;
  amount?: string;
  asset?: string;
  txHash?: string;
  ledgerSequence?: number;
  confirmations?: number;
  requiredConfirmations?: number;
  createdAt?: string;
  updatedAt?: string;
  steps?: LifecycleStep[];
}

export interface AuditLog {
  id: string;
  action: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
  status?: TimelineStepStatus;
  optimistic?: boolean;
  tx_hash?: string;
  ledger_sequence?: number;
}

export interface TimelineProps {
  /** Legacy audit logs for backward compatibility */
  logs?: AuditLog[];
  /** Full Stellar payment lifecycle data */
  lifecycle?: PaymentLifecycleData;
  /** Explicit lifecycle steps for custom sequences */
  steps?: LifecycleStep[];
  /** Active/current step index (0-based) */
  currentStepIndex?: number;
  /** Optional header title */
  title?: string;
  /** Callback fired when a step header is clicked */
  onStepClick?: (step: LifecycleStep, index: number) => void;
  /** Toggle transaction hash copy button */
  showCopyHash?: boolean;
  /** Enable interactive step expansion/collapse */
  interactive?: boolean;
  /** Network name for explorer links (public or testnet) */
  network?: "public" | "testnet";
  className?: string;
}

// ─── Default Steps Generator ────────────────────────────────────────────────

export function getDefaultLifecycleSteps(
  lifecycle?: Partial<PaymentLifecycleData>
): LifecycleStep[] {
  const status = lifecycle?.status || "confirmed";
  const isFailed = status === "failed";
  const isRefunded = status === "refunded";
  const isProcessing = status === "processing" || status === "pending";
  const isConfirmed = status === "confirmed";

  return [
    {
      id: "initiated",
      label: "Payment Initiated",
      description: "Payment transaction created and authorization payload drafted",
      status: "completed",
      timestamp: lifecycle?.createdAt || "2026-11-21T10:00:00.000Z",
      details: {
        amount: lifecycle?.amount || "100.00",
        asset: lifecycle?.asset || "USDC",
      },
    },
    {
      id: "signed",
      label: "Cryptographically Signed",
      description: "Signed with source account keypair via Stellar SDK / Freighter",
      status: "completed",
      timestamp: "2026-11-21T10:01:00.000Z",
      details: {
        fee: "100 stroops (0.00001 XLM)",
        memo: "PLUTO-PAY-INV-849",
      },
    },
    {
      id: "submitted",
      label: "Submitted to Horizon",
      description: "Sent to Stellar network ingest node for consensus validation",
      status: isProcessing ? "current" : "completed",
      timestamp: "2026-11-21T10:02:00.000Z",
      details: {
        txHash: lifecycle?.txHash || "5f4dcc3b5aa765d61d8327deb882cf992b9699aec8a33c8b8714eb6100c5c2d3",
      },
    },
    {
      id: "consensus",
      label: "SCP Consensus & Ledger Ingestion",
      description: "Validated by SCP quorum slice and closed in ledger",
      status: isFailed
        ? "failed"
        : isProcessing
        ? "pending"
        : "completed",
      timestamp: isConfirmed || isRefunded ? "2026-11-21T10:03:00.000Z" : undefined,
      details: {
        ledgerSequence: lifecycle?.ledgerSequence || 51849201,
        confirmations: lifecycle?.confirmations ?? (isConfirmed ? 3 : 1),
        maxConfirmations: lifecycle?.requiredConfirmations ?? 3,
        errorMessage: isFailed ? "Transaction rejected: op_underfunded" : undefined,
      },
    },
    {
      id: "confirmed",
      label: isRefunded ? "Refund Processed" : "On-Chain Confirmed",
      description: isRefunded
        ? "Funds returned to original sender address"
        : isFailed
        ? "Payment failed on ledger"
        : "Finality achieved with full confirmations",
      status: isFailed
        ? "failed"
        : isRefunded
        ? "completed"
        : isConfirmed
        ? "completed"
        : "pending",
      timestamp: isConfirmed || isRefunded ? "2026-11-21T10:04:00.000Z" : undefined,
      details: {
        confirmations: lifecycle?.confirmations ?? (isConfirmed ? 3 : 0),
        maxConfirmations: lifecycle?.requiredConfirmations ?? 3,
      },
    },
  ];
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PaymentLifecycleStatus }) {
  const styles: Record<PaymentLifecycleStatus, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    processing: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    confirmed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    refunded: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${
        styles[status] || styles.confirmed
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {status}
    </span>
  );
}

function ConfirmationTick({
  completed,
  active,
  failed,
  stepNumber,
}: {
  completed: boolean;
  active: boolean;
  failed: boolean;
  stepNumber: number;
}) {
  if (failed) {
    return (
      <div
        className="w-8 h-8 rounded-full bg-rose-500/20 border-2 border-rose-500 flex items-center justify-center text-rose-500 shadow-md shadow-rose-500/20"
        aria-hidden="true"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }

  if (completed) {
    return (
      <div
        className="w-8 h-8 rounded-full bg-emerald-500 border-2 border-emerald-400 flex items-center justify-center text-white shadow-md shadow-emerald-500/30"
        aria-hidden="true"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  if (active) {
    return (
      <div
        className="w-8 h-8 rounded-full bg-blue-600 border-2 border-blue-400 flex items-center justify-center text-white shadow-md shadow-blue-500/40 relative"
        aria-hidden="true"
      >
        <div className="absolute inset-0 rounded-full border-2 border-blue-300 animate-ping opacity-40" />
        <span className="text-xs font-bold">{stepNumber}</span>
      </div>
    );
  };

  if (variant === "inline") {
    return <div className={className}>{renderTimelineBody()}</div>;
  }

  return (
    <div
      className="w-8 h-8 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center text-gray-400"
      aria-hidden="true"
    >
      <span className="text-xs font-medium">{stepNumber}</span>
    </div>
  );
}

// ─── Main Timeline Component ────────────────────────────────────────────────

export default function Timeline({
  logs,
  lifecycle,
  steps: userSteps,
  currentStepIndex,
  title = "Stellar Ledger Payment Lifecycle",
  onStepClick,
  showCopyHash = true,
  interactive = true,
  network = "public",
  className = "",
}: TimelineProps) {
  const uid = useId();
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({
    initiated: false,
    signed: false,
    submitted: true,
    consensus: true,
    confirmed: true,
  });

  const toggleStep = useCallback(
    (stepId: string) => {
      if (!interactive) return;
      setExpandedSteps((prev) => ({
        ...prev,
        [stepId]: !prev[stepId],
      }));
    },
    [interactive]
  );

  const handleCopyHash = useCallback(
    (hash: string, e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => {
        setCopiedHash(null);
      }, 2000);
    },
    []
  );

  // ── Backward compatibility branch: render AuditLog[] if passed directly ──
  if (logs !== undefined) {
    if (!logs || logs.length === 0) {
      return (
        <div
          role="region"
          aria-label="Activity timeline"
          className={`text-gray-400 text-center py-10 rounded-xl border border-gray-800 bg-gray-900/50 ${className}`}
        >
          <svg
            className="w-8 h-8 mx-auto mb-2 text-gray-500 opacity-60"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="font-medium text-sm">No activity yet</p>
        </div>
      );
    }

    return (
      <div
        role="region"
        aria-label="Activity timeline"
        className={`relative border-l-2 border-gray-700/60 pl-6 space-y-6 ml-3 ${className}`}
      >
        {logs.map((log) => (
          <div key={log.id} className="relative group">
            {/* Dot indicator */}
            <div
              className="absolute -left-[31px] top-1.5 w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-gray-900 shadow-sm"
              aria-hidden="true"
            />

            {/* Card Content */}
            <div className="bg-gray-800/90 hover:bg-gray-800 border border-gray-700/60 rounded-xl p-4 transition-all duration-200 shadow-sm">
              <p className="text-white font-semibold text-sm">{log.action}</p>

              {log.field_changed && (
                <div className="mt-2 text-xs font-mono bg-gray-900/80 rounded-md p-2 border border-gray-700/40 text-gray-300">
                  <span className="text-blue-400 font-medium">{log.field_changed}</span>:{" "}
                  <span className="text-rose-400/90 line-through mr-1">{log.old_value}</span>
                  <span className="text-gray-500 mx-1">→</span>
                  <span className="text-emerald-400 font-medium">{log.new_value}</span>
                </div>
              )}

              <p className="text-gray-400 text-[11px] mt-2.5 flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {new Date(log.created_at).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Stellar Payment Lifecycle Timeline ──
  const steps = userSteps || getDefaultLifecycleSteps(lifecycle);
  const activeStatus = lifecycle?.status || "confirmed";

  // Calculate overall completion percentage for stepper
  const completedCount = steps.filter((s) => s.status === "completed").length;
  const progressPercent = Math.min(100, Math.round((completedCount / steps.length) * 100));

  return (
    <div
      role="region"
      aria-label={title}
      className={`flex flex-col gap-6 rounded-2xl bg-gray-900/90 border border-gray-800 p-5 md:p-7 text-white shadow-xl ${className}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg md:text-xl font-bold tracking-tight text-white">{title}</h2>
            <StatusBadge status={activeStatus} />
          </div>
          {lifecycle?.id && (
            <p className="text-xs text-gray-400 font-mono mt-1">Payment ID: {lifecycle.id}</p>
          )}
        </div>

        {/* On-Chain Confirmation Ticks Counter */}
        {lifecycle?.confirmations !== undefined && (
          <div
            className="flex items-center gap-2 bg-gray-800/80 border border-gray-700/60 rounded-xl px-3.5 py-2 text-xs"
            role="status"
            aria-live="polite"
          >
            <svg
              className="w-4 h-4 text-emerald-400 animate-pulse"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-gray-300 font-medium">On-chain ticks:</span>
            <span className="font-bold text-emerald-400">
              {lifecycle.confirmations} / {lifecycle.requiredConfirmations || 3}
            </span>
          </div>
        )}
      </div>

      {/* ── Progress Stepper Bar (Desktop & Tablet) ── */}
      <div
        className="hidden md:block py-2"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Payment lifecycle progress"
      >
        <div className="flex items-center justify-between relative mb-2">
          {/* Background track line */}
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-800 -z-0" aria-hidden="true" />
          {/* Active progress fill */}
          <div
            className="absolute top-4 left-4 h-0.5 bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-500 -z-0"
            style={{ width: `calc(${progressPercent}% - 32px)` }}
            aria-hidden="true"
          />

          {steps.map((step, idx) => {
            const isCompleted = step.status === "completed";
            const isCurrent = step.status === "current" || currentStepIndex === idx;
            const isFailed = step.status === "failed";

            return (
              <div
                key={step.id}
                className="flex flex-col items-center relative z-10 group"
              >
                <ConfirmationTick
                  completed={isCompleted}
                  active={isCurrent}
                  failed={isFailed}
                  stepNumber={idx + 1}
                />
                <span
                  className={`mt-2 text-xs font-semibold max-w-[100px] text-center truncate ${
                    isCompleted
                      ? "text-emerald-400"
                      : isCurrent
                      ? "text-blue-400 font-bold"
                      : isFailed
                      ? "text-rose-400"
                      : "text-gray-500"
                  }`}
                  title={step.label}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Step-by-Step Transaction State Timeline (Vertical with Rich Details) ── */}
      <ol
        role="list"
        aria-label="Payment lifecycle steps"
        className="relative border-l-2 border-gray-800 space-y-5 ml-4 md:ml-5 pl-5 md:pl-6"
      >
        {steps.map((step, index) => {
          const isCompleted = step.status === "completed";
          const isCurrent = step.status === "current" || currentStepIndex === index;
          const isFailed = step.status === "failed";
          const isExpanded = expandedSteps[step.id] ?? false;
          const stepDetailsId = `step-details-${uid}-${step.id}`;

          return (
            <li
              key={step.id}
              className="relative"
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Stepper Node Icon */}
              <div
                className="absolute -left-[37px] md:-left-[41px] top-1.5"
                aria-hidden="true"
              >
                <ConfirmationTick
                  completed={isCompleted}
                  active={isCurrent}
                  failed={isFailed}
                  stepNumber={index + 1}
                />
              </div>

              {/* Step Card */}
              <div
                className={`rounded-xl border transition-all duration-200 ${
                  isCurrent
                    ? "bg-gray-850 border-blue-500/40 shadow-lg shadow-blue-500/10"
                    : isFailed
                    ? "bg-rose-950/20 border-rose-500/40"
                    : isCompleted
                    ? "bg-gray-800/80 border-gray-700/60"
                    : "bg-gray-900/40 border-gray-800 text-gray-500"
                }`}
              >
                {/* Step Header (Clickable / Focusable for Expansion) */}
                <button
                  type="button"
                  onClick={() => {
                    toggleStep(step.id);
                    onStepClick?.(step, index);
                  }}
                  aria-expanded={isExpanded}
                  aria-controls={stepDetailsId}
                  className={`w-full text-left p-4 flex items-start justify-between gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${
                    interactive ? "cursor-pointer hover:bg-white/5" : "cursor-default"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm md:text-base font-semibold text-white">
                        {step.label}
                      </span>
                      {isCompleted && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Confirmed
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                          Processing
                        </span>
                      )}
                      {isFailed && (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Failed
                        </span>
                      )}
                    </div>
                    {step.description && (
                      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        {step.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {step.timestamp && (
                      <time
                        dateTime={step.timestamp}
                        className="text-[11px] text-gray-500 font-mono hidden sm:inline"
                      >
                        {new Date(step.timestamp).toLocaleTimeString()}
                      </time>
                    )}
                    {interactive && (
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                </button>

                {/* Collapsible Details Panel */}
                <AnimatePresence>
                  {isExpanded && step.details && (
                    <motion.div
                      id={stepDetailsId}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-gray-700/40 px-4 py-3 bg-gray-900/60 rounded-b-xl space-y-2.5 text-xs text-gray-300"
                    >
                      {/* Ledger Sequence */}
                      {step.details.ledgerSequence !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400 font-medium">Ledger Sequence</span>
                          <span className="font-mono text-emerald-400 font-semibold">
                            #{step.details.ledgerSequence.toLocaleString()}
                          </span>
                        </div>
                      )}

                      {/* Transaction Hash with Copy Button */}
                      {step.details.txHash && (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pt-1 border-t border-gray-800">
                          <span className="text-gray-400 font-medium">Transaction Hash</span>
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-[11px] bg-gray-950 px-2 py-1 rounded text-blue-300 truncate max-w-[200px] sm:max-w-[260px]">
                              {step.details.txHash}
                            </code>
                            {showCopyHash && (
                              <button
                                type="button"
                                onClick={(e) => handleCopyHash(step.details!.txHash!, e)}
                                aria-label="Copy transaction hash"
                                className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                {copiedHash === step.details.txHash ? (
                                  <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                )}
                              </button>
                            )}
                            {/* Stellar Expert Explorer Link */}
                            <a
                              href={`https://stellar.expert/explorer/${network}/tx/${step.details.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-blue-400 hover:text-blue-300 underline font-medium"
                              aria-label="View on Stellar Expert explorer"
                            >
                              Explore
                            </a>
                          </div>
                        </div>
                      )}

                      {/* Fee */}
                      {step.details.fee && (
                        <div className="flex items-center justify-between pt-1 border-t border-gray-800">
                          <span className="text-gray-400 font-medium">Network Fee</span>
                          <span className="font-mono text-gray-200">{step.details.fee}</span>
                        </div>
                      )}

                      {/* Memo */}
                      {step.details.memo && (
                        <div className="flex items-center justify-between pt-1 border-t border-gray-800">
                          <span className="text-gray-400 font-medium">Memo</span>
                          <span className="font-mono text-gray-200">{step.details.memo}</span>
                        </div>
                      )}

                      {/* Error Message for Failed Step */}
                      {step.details.errorMessage && (
                        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-[11px] mt-2">
                          <span className="font-bold">Error:</span> {step.details.errorMessage}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
