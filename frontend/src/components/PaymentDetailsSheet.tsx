"use client";

import React, { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { localeToLanguageTag } from "@/i18n/config";
import { InfoTooltip } from "@/components/InfoTooltip";
import WebhookDetailModal, { WebhookLog } from "./WebhookDetailModal";

interface PaymentDetails {
  id: string;
  amount: number;
  asset: string;
  asset_issuer: string | null;
  recipient: string;
  description: string | null;
  memo: string | null;
  memo_type: string | null;
  status: string;
  tx_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}



interface PaymentDetailsSheetProps {
  paymentId: string;
  isOpen: boolean;
  onClose: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function PaymentDetailsSheet({
  paymentId,
  isOpen,
  onClose,
}: PaymentDetailsSheetProps) {
  const locale = localeToLanguageTag(useLocale());
  const apiKey = useMerchantApiKey();
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [viewingLog, setViewingLog] = useState<WebhookLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "metadata" | "webhooks">("details");

  useEffect(() => {
    if (!isOpen || !paymentId || !apiKey) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch payment details
        const paymentRes = await fetch(`${API_URL}/api/payments/${paymentId}`, {
          headers: { "x-api-key": apiKey },
        });
        if (!paymentRes.ok) throw new Error("Failed to fetch payment details");
        const paymentData = await paymentRes.json();
        setPayment(paymentData.payment);

        // Fetch webhook logs (simplified mock or actual fetch if available)
        const logsRes = await fetch(`${API_URL}/api/webhook-logs?limit=10`, {
          headers: { "x-api-key": apiKey },
        });
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          setWebhookLogs(logsData.logs || []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [paymentId, isOpen, apiKey]);

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-white/10 bg-night p-0 shadow-2xl"
          >
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                <div>
                  <h2 className="text-xl font-bold text-white">Payment Details</h2>
                  <p className="text-xs font-mono text-slate-400">{paymentId}</p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-white/10 px-6">
                {(["details", "metadata", "webhooks"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? "border-mint text-mint"
                        : "border-transparent text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="flex h-32 items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-mint border-t-transparent" />
                  </div>
                ) : error ? (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
                    {error}
                  </div>
                ) : (
                  <>
                    {activeTab === "details" && payment && (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <DetailItem label="Status" value={
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              payment.status === "confirmed" || payment.status === "completed"
                                ? "bg-green-500/20 text-green-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }`}>
                              {payment.status}
                            </span>
                          } />
                          <DetailItem label="Amount" value={`${payment.amount} ${payment.asset}`} />
                          <DetailItem label="Created At" value={new Date(payment.created_at).toLocaleString(locale)} />
                          <DetailItem 
                            label={
                              <InfoTooltip content="A unique 64-character hash representing this specific transaction on the Stellar network.">
                                Transaction ID
                              </InfoTooltip>
                            } 
                            value={payment.tx_id ? (
                              <a 
                                href={`https://stellar.expert/explorer/testnet/tx/${payment.tx_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-mint hover:underline break-all font-mono text-[10px]"
                              >
                                {payment.tx_id}
                              </a>
                            ) : "Pending"} 
                          />
                        </div>
                        <DetailItem 
                          label={
                            <InfoTooltip content="The Stellar account address that issued the asset. XLM is native and has no issuer.">
                              Asset Issuer
                            </InfoTooltip>
                          } 
                          value={<code className="text-[10px] break-all text-slate-300">{payment.asset_issuer || "Native (Stellar Network)"}</code>} 
                        />
                        <DetailItem label="Recipient" value={<code className="text-[10px] break-all text-slate-300">{payment.recipient}</code>} />
                        <DetailItem label="Description" value={payment.description || "No description"} />
                        
                        {/* Timeline Mock */}
                        <div className="pt-4">
                          <h3 className="mb-4 text-sm font-semibold text-white">Timeline</h3>
                          <div className="space-y-4 border-l-2 border-white/5 pl-4">
                            <TimelineEvent 
                              title="Payment Created" 
                              time={new Date(payment.created_at).toLocaleString(locale)} 
                              completed 
                            />
                            <TimelineEvent 
                              title="Awaiting Payment" 
                              time="—" 
                              active={payment.status === 'pending'}
                              completed={payment.status !== 'pending'}
                            />
                            <TimelineEvent 
                              title="Confirmed on Ledger" 
                              time={payment.status === 'confirmed' || payment.status === 'completed' ? 'Just now' : '—'} 
                              completed={payment.status === 'confirmed' || payment.status === 'completed'}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "metadata" && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-white">Full JSON Metadata</h3>
                        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-sky-300 font-mono">
                          {JSON.stringify(payment?.metadata || {}, null, 2)}
                        </pre>
                      </div>
                    )}

                    {activeTab === "webhooks" && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-white">Webhook Delivery Logs</h3>
                        {webhookLogs.length === 0 ? (
                          <p className="text-sm text-slate-500 italic">No webhook attempts found for this transaction.</p>
                        ) : (
                          <div className="divide-y divide-white/5">
                            {webhookLogs.map((log: WebhookLog) => (
                              <div 
                                key={log.id} 
                                className="py-3 cursor-pointer hover:bg-white/5 transition-colors rounded-lg px-2 -mx-2"
                                onClick={() => setViewingLog(log)}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-mono text-white">{log.event || log.id}</span>
                                  <span className={`text-[10px] font-bold ${log.status_code >= 200 && log.status_code < 300 ? 'text-green-400' : 'text-red-400'}`}>
                                    HTTP {log.status_code}
                                  </span>
                                </div>
                                <p className="mt-1 text-[10px] text-slate-500">{new Date(log.timestamp).toLocaleString(locale)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
          <WebhookDetailModal
            isOpen={!!viewingLog}
            onClose={() => setViewingLog(null)}
            log={viewingLog}
          />
        </>
      )}
    </AnimatePresence>
  );
}

function DetailItem({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm text-slate-200">{value}</div>
    </div>
  );
}

function TimelineEvent({ title, time, completed = false, active = false }: { title: string; time: string; completed?: boolean; active?: boolean }) {
  return (
    <div className="relative">
      <div className={`absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 bg-night ${
        completed ? 'border-mint bg-mint' : active ? 'border-mint' : 'border-white/10'
      }`} />
      <div>
        <p className={`text-xs font-medium ${completed || active ? 'text-white' : 'text-slate-500'}`}>{title}</p>
        <p className="text-[10px] text-slate-500">{time}</p>
      </div>
    </div>
  );
}
