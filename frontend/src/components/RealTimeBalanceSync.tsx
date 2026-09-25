"use client";

import React, { useId } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { useBalanceSync } from "@/hooks/useBalanceSync";

interface RealTimeBalanceSyncProps {
  merchantId?: string | null;
  apiKey?: string | null;
  address?: string | null;
  horizonUrl?: string;
  pollingInterval?: number;
  className?: string;
}

const containerVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: "easeOut" },
  },
};

const listVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.25, ease: "easeOut" },
  },
  exit: {
    opacity: 0,
    x: 12,
    transition: { duration: 0.15 },
  },
};

export function RealTimeBalanceSync({
  merchantId,
  apiKey,
  address,
  horizonUrl,
  pollingInterval = 30000,
  className = "",
}: RealTimeBalanceSyncProps) {
  const liveId = useId();
  const locale = useLocale();
  const t = useTranslations("realTimeBalanceSync");
  const shouldReduceMotion = useReducedMotion();

  const { balances, isLoading, lastUpdated, error, refresh } = useBalanceSync(
    merchantId,
    apiKey,
    {
      address,
      horizonUrl,
      pollingInterval,
      enabled: true,
    },
  );

  const liveRegionText = isLoading
    ? t("liveRegion.syncing")
    : error
      ? t("liveRegion.error", { error })
      : lastUpdated
        ? t("liveRegion.updatedAt", {
            time: lastUpdated.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
            }),
          })
        : "";

  const animProps = shouldReduceMotion
    ? { initial: false, animate: {}, variants: undefined }
    : { variants: containerVariants, initial: "hidden", animate: "visible" };

  return (
    <motion.section
      className={`w-full rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out dark:border-slate-700 dark:bg-slate-900 ${isLoading ? "ring-2 ring-sky-200 dark:ring-sky-800" : ""} ${className}`}
      aria-label={t("sectionAriaLabel")}
      aria-busy={isLoading}
      {...animProps}
    >
      <div
        id={liveId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveRegionText}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
            {t("title")}
          </h2>
          <AnimatePresence mode="wait">
            {isLoading && (
              <motion.div
                key="loading-indicator"
                initial={
                  shouldReduceMotion ? undefined : { opacity: 0, scale: 0.8 }
                }
                animate={
                  shouldReduceMotion ? undefined : { opacity: 1, scale: 1 }
                }
                exit={
                  shouldReduceMotion ? undefined : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1"
              >
                <motion.div
                  animate={shouldReduceMotion ? undefined : { rotate: 360 }}
                  transition={
                    shouldReduceMotion
                      ? undefined
                      : {
                          duration: 1,
                          repeat: Number.POSITIVE_INFINITY,
                          ease: "linear",
                        }
                  }
                  className="h-3 w-3 rounded-full border-2 border-sky-200 border-t-sky-600"
                  role="status"
                  aria-label="Loading"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <motion.button
          onClick={refresh}
          disabled={isLoading}
          whileHover={
            shouldReduceMotion || isLoading ? undefined : { scale: 1.05 }
          }
          whileTap={
            shouldReduceMotion || isLoading ? undefined : { scale: 0.95 }
          }
          aria-label={t("refreshButton")}
          aria-describedby={liveId}
          className="group relative inline-flex items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white px-3.5 py-2 text-sm font-semibold text-sky-600 shadow-sm transition-all duration-200 hover:border-sky-300 hover:from-sky-100 hover:to-sky-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 dark:border-slate-700 dark:from-slate-800 dark:to-slate-900 dark:text-sky-400 dark:hover:border-sky-600 dark:hover:from-slate-700 dark:hover:to-slate-800"
        >
          <motion.span
            className="relative z-10 flex items-center gap-1.5"
            initial={false}
            animate={isLoading ? { opacity: 0.7 } : { opacity: 1 }}
          >
            {isLoading && (
              <motion.svg
                animate={shouldReduceMotion ? undefined : { rotate: 360 }}
                transition={
                  shouldReduceMotion
                    ? undefined
                    : {
                        duration: 1,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: "linear",
                      }
                }
                className="h-3.5 w-3.5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </motion.svg>
            )}
            {isLoading ? t("syncing") : t("refreshButton")}
          </motion.span>
          {!isLoading && !shouldReduceMotion && (
            <motion.div
              className="absolute inset-0 z-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              initial={{ x: "-100%" }}
              whileHover={{ x: "100%" }}
              transition={{ duration: 0.6 }}
            />
          )}
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {error ? (
          <motion.p
            key="error"
            role="alert"
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-3 text-sm font-medium text-red-600 dark:text-red-400"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {!error && balances.length === 0 && !isLoading ? (
        <motion.div
          key="empty"
          initial={shouldReduceMotion ? undefined : { opacity: 0, y: 10 }}
          animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
          className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/50 px-4 py-8 transition-all duration-300 hover:border-slate-200 hover:shadow-sm dark:border-slate-800 dark:from-slate-800 dark:to-slate-900/50"
          aria-live="polite"
        >
          <motion.div
            className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-slate-200/30 dark:bg-slate-700/30"
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    scale: [1, 1.2, 1],
                    opacity: [0.3, 0.5, 0.3],
                  }
            }
            transition={
              shouldReduceMotion
                ? undefined
                : {
                    duration: 3,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }
            }
          />
          <div className="relative">
            <svg
              className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
            <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
              {t("emptyState")}
            </p>
          </div>
        </motion.div>
      ) : isLoading && balances.length === 0 ? (
        <motion.div
          key="skeleton"
          initial={shouldReduceMotion ? undefined : { opacity: 0 }}
          animate={shouldReduceMotion ? undefined : { opacity: 1 }}
          className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50"
        >
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <motion.div
                className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700"
                animate={
                  shouldReduceMotion
                    ? undefined
                    : {
                        opacity: [0.5, 0.8, 0.5],
                      }
                }
                transition={
                  shouldReduceMotion
                    ? undefined
                    : {
                        duration: 1.5,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: "easeInOut",
                        delay: i * 0.1,
                      }
                }
              />
              <motion.div
                className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700"
                animate={
                  shouldReduceMotion
                    ? undefined
                    : {
                        opacity: [0.5, 0.8, 0.5],
                      }
                }
                transition={
                  shouldReduceMotion
                    ? undefined
                    : {
                        duration: 1.5,
                        repeat: Number.POSITIVE_INFINITY,
                        ease: "easeInOut",
                        delay: i * 0.1 + 0.2,
                      }
                }
              />
            </div>
          ))}
        </motion.div>
      ) : (
        <motion.ul
          role="list"
          aria-label={t("balancesListAriaLabel")}
          className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 divide-y divide-slate-100 dark:border-slate-800 dark:bg-slate-800/50 dark:divide-slate-700"
          variants={shouldReduceMotion ? undefined : listVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {balances.map((b) => {
              const formattedBalance = parseFloat(b.balance).toLocaleString(
                locale,
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 7,
                },
              );

              return (
                <motion.li
                  key={b.code}
                  layout={shouldReduceMotion ? undefined : true}
                  variants={shouldReduceMotion ? undefined : itemVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="group relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5 px-4 transition-colors hover:bg-white/50 dark:hover:bg-slate-700/30"
                  aria-label={t("balanceItemAriaLabel", {
                    asset: b.code,
                    balance: formattedBalance,
                  })}
                >
                  <div className="flex min-w-0 shrink-0 items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-100 to-blue-100 text-xs font-bold text-sky-700 dark:from-sky-900/30 dark:to-blue-900/30 dark:text-sky-400">
                      {b.code.slice(0, 2)}
                    </div>
                    <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {b.code}
                    </span>
                  </div>
                  <motion.span
                    className="min-w-0 break-all text-right text-base tabular-nums font-bold text-slate-900 dark:text-white"
                    key={`${b.code}-${b.balance}`}
                    initial={
                      shouldReduceMotion
                        ? undefined
                        : { opacity: 0, scale: 0.95 }
                    }
                    animate={
                      shouldReduceMotion ? undefined : { opacity: 1, scale: 1 }
                    }
                    transition={{ duration: 0.3 }}
                  >
                    {formattedBalance}
                  </motion.span>
                  {!shouldReduceMotion && (
                    <motion.div
                      className="absolute inset-0 -z-10 bg-gradient-to-r from-transparent via-sky-50/0 to-transparent dark:via-sky-900/0"
                      initial={{ x: "-100%", opacity: 0 }}
                      whileHover={{ x: "100%", opacity: 1 }}
                      transition={{ duration: 0.6 }}
                    />
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}

      {lastUpdated && (
        <motion.div
          className="mt-4 flex items-center gap-2"
          initial={shouldReduceMotion ? undefined : { opacity: 0, y: 5 }}
          animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <div className="flex h-5 w-5 items-center justify-center">
            <motion.div
              className="h-2 w-2 rounded-full bg-emerald-500"
              animate={
                shouldReduceMotion
                  ? undefined
                  : {
                      scale: [1, 1.2, 1],
                      opacity: [1, 0.7, 1],
                    }
              }
              transition={
                shouldReduceMotion
                  ? undefined
                  : {
                      duration: 2,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }
              }
            />
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            <span className="font-semibold text-slate-500 dark:text-slate-400">
              {t("updatedLabel")}
            </span>{" "}
            <time dateTime={lastUpdated.toISOString()} className="tabular-nums">
              {lastUpdated.toLocaleTimeString(locale, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </p>
        </motion.div>
      )}
    </motion.section>
  );
}

export default RealTimeBalanceSync;
