"use client";

import RecentPayments from "@/components/RecentPayments";

export default function PaymentsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Payment History</h1>
        <p className="mt-2 text-slate-400">
          Monitor all incoming transactions and their verification status.
        </p>
      </div>
      <RecentPayments />
    </div>
  );
}
