/**
 * ExportCsvButton
 * Issue #175 – [FE] CSV Export for Transaction History
 */

"use client";

import React, { useState, useCallback } from "react";
import { exportTransactionsToCsv, Transaction } from "@/lib/exportCsv";

interface ExportCsvButtonProps {
  transactions: Transaction[];
  filename?:    string;
  disabled?:    boolean;
  className?:   string;
}

export default function ExportCsvButton({
  transactions = [],
  filename,
  disabled  = false,
  className = "",
}: ExportCsvButtonProps): React.ReactElement {
  const [exporting, setExporting] = useState<boolean>(false);

  const handleExport = useCallback(async (): Promise<void> => {
    if (!transactions.length) return;
    setExporting(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      exportTransactionsToCsv(transactions, filename);
    } finally {
      setExporting(false);
    }
  }, [transactions, filename]);

  const isDisabled = disabled || exporting || transactions.length === 0;

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isDisabled}
      aria-label="Export transaction history to CSV"
      className={[
        "inline-flex items-center gap-1.5 rounded-md border border-blue-600",
        "px-3 py-1.5 text-sm font-medium text-blue-600",
        "transition-colors hover:bg-blue-600 hover:text-white",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {exporting ? (
        <>
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
            />
          </svg>
          Exporting…
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
          Export to CSV
        </>
      )}
    </button>
  );
}
