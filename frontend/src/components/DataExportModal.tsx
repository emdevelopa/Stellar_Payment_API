"use client";

/**
 * DataExportModal — Interactive Data Export Modal
 *
 * Provides format selection (CSV / JSON), column toggling, date-range
 * filtering, and rich per-phase loading states so users always know
 * exactly what is happening during a potentially slow export.
 *
 * Loading phases
 * ──────────────
 *  "idle"       → initial state, action buttons are active
 *  "preparing"  → validating selection & building payload (instant UX feedback)
 *  "exporting"  → serialising rows and triggering download
 *  "done"       → success confirmation before auto-close
 *  "error"      → inline error with retry affordance
 */

import React, { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { type CsvColumn, CSV_COLUMNS, type Transaction, transactionsToCsv, downloadCsv } from "@/lib/exportCsv";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json";

type Phase = "idle" | "preparing" | "exporting" | "done" | "error";

interface State {
  phase: Phase;
  format: ExportFormat;
  selectedColumns: Set<string>;
  fromDate: string;
  toDate: string;
  errorMessage: string;
  rowsExported: number;
}

type Action =
  | { type: "SET_FORMAT"; format: ExportFormat }
  | { type: "TOGGLE_COLUMN"; key: string }
  | { type: "SELECT_ALL_COLUMNS" }
  | { type: "DESELECT_ALL_COLUMNS" }
  | { type: "SET_FROM_DATE"; value: string }
  | { type: "SET_TO_DATE"; value: string }
  | { type: "BEGIN_PREPARE" }
  | { type: "BEGIN_EXPORT" }
  | { type: "EXPORT_DONE"; rows: number }
  | { type: "EXPORT_ERROR"; message: string }
  | { type: "RESET" };

// ── Reducer ───────────────────────────────────────────────────────────────────

const allColumnKeys = new Set(CSV_COLUMNS.map((c) => c.key as string));

function buildInitialState(): State {
  return {
    phase: "idle",
    format: "csv",
    selectedColumns: new Set(allColumnKeys),
    fromDate: "",
    toDate: "",
    errorMessage: "",
    rowsExported: 0,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_FORMAT":
      return { ...state, format: action.format };
    case "TOGGLE_COLUMN": {
      const next = new Set(state.selectedColumns);
      if (next.has(action.key)) { next.delete(action.key); } else { next.add(action.key); }
      return { ...state, selectedColumns: next };
    }
    case "SELECT_ALL_COLUMNS":
      return { ...state, selectedColumns: new Set(allColumnKeys) };
    case "DESELECT_ALL_COLUMNS":
      return { ...state, selectedColumns: new Set() };
    case "SET_FROM_DATE":
      return { ...state, fromDate: action.value };
    case "SET_TO_DATE":
      return { ...state, toDate: action.value };
    case "BEGIN_PREPARE":
      return { ...state, phase: "preparing", errorMessage: "" };
    case "BEGIN_EXPORT":
      return { ...state, phase: "exporting" };
    case "EXPORT_DONE":
      return { ...state, phase: "done", rowsExported: action.rows };
    case "EXPORT_ERROR":
      return { ...state, phase: "error", errorMessage: action.message };
    case "RESET":
      return buildInitialState();
    default:
      return state;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DataExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  filename?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DataExportModal({
  isOpen,
  onClose,
  transactions,
  filename,
}: DataExportModalProps): React.ReactElement | null {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap focus inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-close 2 s after successful export
  useEffect(() => {
    if (state.phase !== "done") return;
    const id = setTimeout(() => handleClose(), 2000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const handleClose = useCallback(() => {
    dispatch({ type: "RESET" });
    onClose();
  }, [onClose]);

  const handleExport = useCallback(async () => {
    if (!transactions.length) return;

    dispatch({ type: "BEGIN_PREPARE" });
    await tick();

    try {
      // Date-range filter
      const from = state.fromDate ? new Date(state.fromDate).getTime() : -Infinity;
      const to = state.toDate ? new Date(state.toDate + "T23:59:59Z").getTime() : Infinity;

      const filtered = transactions.filter((tx) => {
        const t = new Date(tx.createdAt).getTime();
        return t >= from && t <= to;
      });

      const columns: CsvColumn[] = CSV_COLUMNS.filter((c) =>
        state.selectedColumns.has(c.key as string)
      );

      dispatch({ type: "BEGIN_EXPORT" });
      await tick();

      if (state.format === "csv") {
        const csv = transactionsToCsv(filtered, columns);
        downloadCsv(csv, filename);
      } else {
        const keys = columns.map((c) => c.key as keyof Transaction);
        const data = filtered.map((tx) =>
          Object.fromEntries(keys.map((k) => [k, tx[k] ?? ""]))
        );
        const json = JSON.stringify(data, null, 2);
        downloadBlob(json, "application/json", filename?.replace(/\.csv$/, ".json"));
      }

      dispatch({ type: "EXPORT_DONE", rows: filtered.length });
    } catch (err) {
      dispatch({
        type: "EXPORT_ERROR",
        message: err instanceof Error ? err.message : "Export failed. Please try again.",
      });
    }
  // Capture state values via closure intentionally
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, filename, state.format, state.selectedColumns, state.fromDate, state.toDate]);

  if (!isOpen) return null;

  const isBusy = state.phase === "preparing" || state.phase === "exporting";
  const allSelected = state.selectedColumns.size === allColumnKeys.size;
  const noneSelected = state.selectedColumns.size === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
        data-testid="export-modal-backdrop"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900 shadow-2xl outline-none"
        data-testid="export-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <p id={titleId} className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
            Export Data
          </p>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="Close export modal"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 text-white">

          {/* ── Loading overlay ── */}
          {isBusy && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-slate-900/90 backdrop-blur-sm"
              aria-live="polite"
              aria-atomic="true"
              data-testid="export-loading-overlay"
            >
              <SpinnerIcon className="h-10 w-10 text-mint" />
              <p className="text-sm font-medium text-slate-300">
                {state.phase === "preparing" ? "Preparing export…" : "Generating file…"}
              </p>
              <ProgressBar />
            </div>
          )}

          {/* ── Done state ── */}
          {state.phase === "done" && (
            <div
              className="flex flex-col items-center gap-3 py-6 text-center"
              aria-live="polite"
              data-testid="export-done"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/20">
                <svg className="h-7 w-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-base font-semibold text-white">Export complete</p>
              <p className="text-sm text-slate-400">
                {state.rowsExported} row{state.rowsExported !== 1 ? "s" : ""} exported successfully.
              </p>
            </div>
          )}

          {/* ── Error state ── */}
          {state.phase === "error" && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4"
              data-testid="export-error"
            >
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Export failed</p>
                <p className="mt-0.5 text-xs text-red-300/80">{state.errorMessage}</p>
              </div>
            </div>
          )}

          {/* ── Idle / form ── */}
          {(state.phase === "idle" || state.phase === "error") && (
            <>
              {/* Format selector */}
              <fieldset>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Format
                </legend>
                <div className="flex gap-3">
                  {(["csv", "json"] as ExportFormat[]).map((fmt) => (
                    <label
                      key={fmt}
                      className={[
                        "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                        state.format === fmt
                          ? "border-mint/60 bg-mint/10 text-mint"
                          : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white",
                      ].join(" ")}
                    >
                      <input
                        type="radio"
                        name="export-format"
                        value={fmt}
                        checked={state.format === fmt}
                        onChange={() => dispatch({ type: "SET_FORMAT", format: fmt })}
                        className="sr-only"
                      />
                      {fmt.toUpperCase()}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Date range */}
              <fieldset>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Date range <span className="normal-case text-slate-500">(optional)</span>
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { label: "From", value: state.fromDate, action: "SET_FROM_DATE" as const },
                      { label: "To", value: state.toDate, action: "SET_TO_DATE" as const },
                    ] as const
                  ).map(({ label, value, action }) => (
                    <div key={label}>
                      <label className="mb-1 block text-xs text-slate-500">{label}</label>
                      <input
                        type="date"
                        value={value}
                        onChange={(e) => dispatch({ type: action, value: e.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-mint/50 focus:outline-none focus:ring-1 focus:ring-mint/30"
                      />
                    </div>
                  ))}
                </div>
              </fieldset>

              {/* Column selector */}
              <fieldset>
                <div className="mb-2 flex items-center justify-between">
                  <legend className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Columns
                  </legend>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "SELECT_ALL_COLUMNS" })}
                      disabled={allSelected}
                      className="text-xs text-mint underline-offset-2 hover:underline disabled:opacity-40"
                    >
                      All
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "DESELECT_ALL_COLUMNS" })}
                      disabled={noneSelected}
                      className="text-xs text-slate-400 underline-offset-2 hover:underline disabled:opacity-40"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="grid max-h-44 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {CSV_COLUMNS.map((col) => {
                    const checked = state.selectedColumns.has(col.key as string);
                    return (
                      <label
                        key={col.key as string}
                        className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => dispatch({ type: "TOGGLE_COLUMN", key: col.key as string })}
                          className="h-4 w-4 rounded border-white/20 bg-slate-700 text-mint focus:ring-mint/40"
                        />
                        <span className={checked ? "" : "text-slate-500"}>{col.label}</span>
                      </label>
                    );
                  })}
                </div>

                {noneSelected && (
                  <p role="alert" className="mt-2 text-xs text-amber-400">
                    Select at least one column to export.
                  </p>
                )}
              </fieldset>
            </>
          )}
        </div>

        {/* Footer */}
        {(state.phase === "idle" || state.phase === "error") && (
          <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!transactions.length || noneSelected}
              className="inline-flex items-center gap-2 rounded-lg bg-mint px-5 py-2 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="export-submit"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Export {state.format.toUpperCase()}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={["animate-spin", className].filter(Boolean).join(" ")} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

function ProgressBar() {
  return (
    <div className="w-48 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div className="h-1 w-1/2 animate-[progress_1s_ease-in-out_infinite_alternate] rounded-full bg-mint" />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function downloadBlob(content: string, mimeType: string, filename?: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `export_${new Date().toISOString().slice(0, 10)}.json`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
