"use client";

import React, { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { useMerchantApiKey } from "@/lib/merchant-store";
import { localeToLanguageTag } from "@/i18n/config";
import WebhookDetailModal, { WebhookLog } from "./WebhookDetailModal";

interface PaymentDetails {
  id: string; amount: number; asset: string; asset_issuer: string | null;
  recipient: string; description: string | null; memo: string | null;
  memo_type: string | null; status: string; tx_id: string | null;
  metadata: Record<string, unknown> | null; created_at: string;
}

interface PaymentDetailsSheetProps {
  paymentId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending:   "bg-yellow-50 text-yellow-700 border-yellow-200",
  failed:    "bg-red-50 text-red-700 border-red-200",
  refunded:  "bg-blue-50 text-blue-700 border-blue-200",
};
const STATUS_DOT: Record<string, string> = {
  confirmed: "bg-emerald-500", completed: "bg-emerald-500",
  pending: "bg-yellow-500", failed: "bg-red-500", refunded: "bg-blue-500",
};

export default function PaymentDetailsSheet({ paymentId, isOpen, onClose }: PaymentDetailsSheetProps) {
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
    setLoading(true); setError(null); setPayment(null);
    const load = async () => {
      try {
        const [pRes, lRes] = await Promise.all([
          fetch(`${API_URL}/api/payments/${paymentId}`, { headers: { "x-api-key": apiKey } }),
          fetch(`${API_URL}/api/webhook-logs?limit=10`, { headers: { "x-api-key": apiKey } }),
        ]);
        if (!pRes.ok) throw new Error("Failed to fetch payment details");
        const pd = await pRes.json();
        setPayment(pd.payment);
        if (lRes.ok) { const ld = await lRes.json(); setWebhookLogs(ld.logs || []); }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally { setLoading(false); }
    };
    load();
  }, [paymentId, isOpen, apiKey]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />

          <motion.div
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 220 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-[#E8E8E8] bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between border-b border-[#E8E8E8] px-6 py-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-[#0A0A0A]">Payment Details</h2>
                <code className="font-mono text-[10px] text-[#6B6B6B]">{paymentId}</code>
              </div>
              <button onClick={onClose} className="rounded-xl border border-[#E8E8E8] p-2 text-[#6B6B6B] hover:bg-[#F5F5F5] hover:text-[#0A0A0A] transition-all">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 border-b border-[#E8E8E8] px-6">
              {(["details", "metadata", "webhooks"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                    activeTab === tab ? "text-[var(--pluto-600)]" : "text-[#6B6B6B] hover:text-[var(--pluto-500)]"
                  }`}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--pluto-500)]" />}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0A0A0A] border-t-transparent" />
                </div>
              ) : error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
              ) : (
                <>
                  {activeTab === "details" && payment && (
                    <div className="flex flex-col gap-6">
                      {/* Amount hero */}
                      <div className="rounded-2xl border border-[#E8E8E8] bg-[#F9F9F9] p-5 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-1">Amount</p>
                          <p className="text-3xl font-bold text-[#0A0A0A]">
                            {payment.amount} <span className="text-base font-bold text-[#6B6B6B]">{payment.asset}</span>
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLE[payment.status] ?? "bg-[#F9F9F9] text-[#6B6B6B] border-[#E8E8E8]"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[payment.status] ?? "bg-[#6B6B6B]"}`} />
                          {payment.status}
                        </span>
                      </div>

                      {/* Details grid */}
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Created" value={new Date(payment.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })} />
                        <Field label="Asset" value={payment.asset} />
                        {payment.memo && <Field label={`Memo (${payment.memo_type ?? "text"})`} value={payment.memo} mono />}
                        {payment.description && <Field label="Description" value={payment.description} />}
                      </div>

                      <Field label="Recipient" value={payment.recipient} mono />
                      {payment.asset_issuer && <Field label="Asset Issuer" value={payment.asset_issuer} mono />}

                      {payment.tx_id && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Transaction Hash</p>
                          <a href={`${EXPLORER}${payment.tx_id}`} target="_blank" rel="noopener noreferrer"
                            className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-3 font-mono text-xs text-[#0A0A0A] underline underline-offset-2 hover:bg-white transition-all break-all block">
                            {payment.tx_id}
                          </a>
                        </div>
                      )}

                      {/* Timeline */}
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] mb-4">Timeline</p>
                        <div className="flex flex-col gap-0 border-l-2 border-[#E8E8E8] pl-5">
                          <TimelineEvent title="Payment Created" time={new Date(payment.created_at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })} done />
                          <TimelineEvent title="Awaiting Payment" time="—" active={payment.status === "pending"} done={payment.status !== "pending"} />
                          <TimelineEvent title="Confirmed on Ledger" time={payment.status === "confirmed" || payment.status === "completed" ? "Confirmed" : "—"} done={payment.status === "confirmed" || payment.status === "completed"} last />
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "metadata" && (
                    <div className="flex flex-col gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Raw Metadata</p>
                      <pre className="overflow-x-auto rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-4 text-xs text-[#0A0A0A] font-mono leading-relaxed">
                        {JSON.stringify(payment?.metadata || {}, null, 2)}
                      </pre>
                    </div>
                  )}

                  {activeTab === "webhooks" && (
                    <div className="flex flex-col gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Webhook Delivery Logs</p>
                      {webhookLogs.length === 0 ? (
                        <div className="rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] p-8 text-center text-sm text-[#6B6B6B]">
                          No webhook attempts found.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#E8E8E8] overflow-hidden divide-y divide-[#E8E8E8]">
                          {webhookLogs.map(log => (
                            <button key={log.id} onClick={() => setViewingLog(log)}
                              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F9F9F9] transition-colors">
                              <div>
                                <p className="text-xs font-bold text-[#0A0A0A]">{log.event || log.id}</p>
                                <p className="text-[10px] text-[#6B6B6B] mt-0.5">{new Date(log.timestamp).toLocaleString(locale)}</p>
                              </div>
                              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${log.status_code >= 200 && log.status_code < 300 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                                {log.status_code}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>

          <WebhookDetailModal isOpen={!!viewingLog} onClose={() => setViewingLog(null)} log={viewingLog} />
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">{label}</p>
      <p className={`rounded-xl border border-[#E8E8E8] bg-[#F9F9F9] px-4 py-2.5 text-sm text-[#0A0A0A] break-all ${mono ? "font-mono text-xs" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}

function TimelineEvent({ title, time, done = false, active = false, last = false }: { title: string; time: string; done?: boolean; active?: boolean; last?: boolean }) {
  return (
    <div className={`relative pb-5 ${last ? "pb-0" : ""}`}>
      <span className={`absolute -left-[21px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
        done ? "border-[#0A0A0A] bg-[#0A0A0A]" : active ? "border-[#0A0A0A] bg-white" : "border-[#E8E8E8] bg-white"
      }`}>
        {done && <svg className="h-2 w-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
      </span>
      <p className={`text-sm font-bold ${done || active ? "text-[#0A0A0A]" : "text-[#6B6B6B]"}`}>{title}</p>
      <p className="text-xs text-[#6B6B6B] mt-0.5">{time}</p>
    </div>
  );
}
