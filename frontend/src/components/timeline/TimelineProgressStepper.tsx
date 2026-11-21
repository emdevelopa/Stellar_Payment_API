"use client";

import { memo } from "react";

export interface PaymentLifecycleStep {
  id: string;
  label: string;
  status: "completed" | "current" | "upcoming" | "failed";
}

interface TimelineProgressStepperProps {
  steps: PaymentLifecycleStep[];
}

function TimelineProgressStepper({ steps }: TimelineProgressStepperProps) {
  if (!steps.length) return null;

  return (
    <nav aria-label="Payment lifecycle progress" className="mb-6">
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const isCompleted = step.status === "completed";
          const isCurrent = step.status === "current";
          const isFailed = step.status === "failed";

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                isFailed
                  ? "border-red-500/50 bg-red-950/40 text-red-200"
                  : isCompleted
                    ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
                    : isCurrent
                      ? "border-blue-500/60 bg-blue-950/40 text-blue-100"
                      : "border-gray-700/70 bg-gray-800/50 text-gray-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isFailed
                    ? "bg-red-500 text-white"
                    : isCompleted
                      ? "bg-emerald-500 text-gray-950"
                      : isCurrent
                        ? "bg-blue-500 text-white"
                        : "bg-gray-700 text-gray-300"
                }`}
              >
                {isCompleted ? "OK" : isFailed ? "!" : index + 1}
              </span>
              <span className="truncate font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default memo(TimelineProgressStepper);
