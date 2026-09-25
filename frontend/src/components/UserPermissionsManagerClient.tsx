"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  usePermissionsStore,
  type Permission,
} from "@/hooks/usePermissionsStore";
import { Spinner } from "@/components/ui/Spinner";

export interface UserPermissionsManagerProps {
  userId: string;
  showCategories?: boolean;
  isReadOnly?: boolean;
  onPermissionsChange?: (permissions: Permission[]) => Promise<void> | void;
}

const CATEGORY_ORDER: Permission["category"][] = [
  "payment",
  "webhook",
  "analytics",
  "admin",
];

// Category icons mapping for enhanced visual hierarchy
const CATEGORY_ICONS = {
  payment: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  ),
  webhook: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  analytics: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  ),
  admin: (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  ),
};

const rowVariants = {
  hidden: { opacity: 0, y: -8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 30,
    },
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: {
      duration: 0.2,
    },
  },
};

const categoryVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: {
      type: "spring",
      stiffness: 350,
      damping: 32,
      opacity: { duration: 0.2 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: {
      duration: 0.25,
      ease: "easeOut",
    },
  },
};

// ---------- sub-components ----------

interface PermissionRowProps {
  permission: Permission;
  isPending: boolean;
  isReadOnly: boolean;
  onToggle: (id: string) => void;
}

function PermissionRow({
  permission,
  isPending,
  isReadOnly,
  onToggle,
}: PermissionRowProps) {
  const t = useTranslations("permissions");
  const disabled = isReadOnly || isPending;

  return (
    <motion.div
      variants={rowVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      aria-busy={isPending}
      className={[
        "group relative flex items-start sm:items-center justify-between gap-4",
        "py-4 px-3 sm:px-4 rounded-lg transition-all duration-200",
        "border border-transparent hover:border-pluto-100 hover:bg-pluto-50/30",
        "dark:hover:border-pluto-800 dark:hover:bg-pluto-900/20",
        disabled && "opacity-60",
      ].join(" ")}
      role="listitem"
    >
      {/* Permission Details */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm sm:text-base font-semibold text-pluto-900 dark:text-pluto-100 leading-tight">
            {permission.name}
          </h4>
          {isPending && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] sm:text-xs font-medium text-pluto-600 bg-pluto-50 dark:bg-pluto-900/30 dark:text-pluto-400 rounded-full border border-pluto-200 dark:border-pluto-700"
            >
              <Spinner size="sm" className="h-3 w-3" />
              <span className="sr-only">{t("updating")}</span>
              <span aria-hidden="true">Updating...</span>
            </motion.span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-pluto-600 dark:text-pluto-400 leading-relaxed pr-2">
          {permission.description}
        </p>
        {permission.lastModified && (
          <span className="text-[10px] sm:text-xs text-pluto-500 dark:text-pluto-500 mt-0.5">
            Last modified:{" "}
            {new Date(permission.lastModified).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Toggle Switch */}
      <div className="flex-shrink-0">
        <label className="relative inline-flex items-center cursor-pointer select-none group/switch">
          <input
            type="checkbox"
            aria-label={`Toggle ${permission.name}`}
            aria-describedby={`perm-desc-${permission.id}`}
            checked={permission.granted}
            disabled={disabled}
            onChange={() => onToggle(permission.id)}
            className="sr-only peer"
          />
          <div
            className={[
              "w-12 h-7 sm:w-14 sm:h-8 rounded-full transition-all duration-300 ease-out",
              "peer-focus-visible:ring-3 peer-focus-visible:ring-pluto-500 peer-focus-visible:ring-offset-2",
              "peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-pluto-900",
              "shadow-inner",
              permission.granted
                ? "bg-gradient-to-r from-pluto-500 to-pluto-600 shadow-pluto-300/50"
                : "bg-pluto-200 dark:bg-pluto-800",
              !disabled && "group-hover/switch:shadow-lg",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <motion.div
              className={[
                "absolute top-1 h-5 w-5 sm:h-6 sm:w-6 rounded-full",
                "bg-white shadow-md flex items-center justify-center",
                !disabled && "group-hover/switch:shadow-lg",
              ].join(" ")}
              animate={{
                left: permission.granted ? "26px" : "4px",
              }}
              transition={{
                type: "spring",
                stiffness: 550,
                damping: 35,
              }}
            >
              {permission.granted && (
                <motion.svg
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 600, damping: 25 }}
                  className="w-3 h-3 sm:w-4 sm:h-4 text-pluto-600"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </motion.svg>
              )}
            </motion.div>
          </div>
          <span className="ml-3 text-xs sm:text-sm font-medium text-pluto-700 dark:text-pluto-300">
            {permission.granted ? "Enabled" : "Disabled"}
          </span>
        </label>
      </div>

      <span id={`perm-desc-${permission.id}`} className="sr-only">
        {permission.description}
      </span>
    </motion.div>
  );
}

interface CategorySectionProps {
  category: Permission["category"];
  items: Permission[];
  isExpanded: boolean;
  pendingIds: Set<string>;
  isReadOnly: boolean;
  label: string;
  onToggleCategory: (category: string) => void;
  onTogglePermission: (id: string) => void;
}

function CategorySection({
  category,
  items,
  isExpanded,
  pendingIds,
  isReadOnly,
  label,
  onToggleCategory,
  onTogglePermission,
}: CategorySectionProps) {
  const grantedCount = items.filter((p) => p.granted).length;
  const totalCount = items.length;
  const icon = CATEGORY_ICONS[category];

  return (
    <div
      className={[
        "border-2 rounded-2xl overflow-hidden transition-all duration-300",
        "shadow-sm hover:shadow-md",
        isExpanded
          ? "border-pluto-300 dark:border-pluto-600 bg-white dark:bg-pluto-900/20"
          : "border-pluto-200 dark:border-pluto-700 bg-pluto-50/50 dark:bg-pluto-900/10",
      ].join(" ")}
    >
      {/* Category Header */}
      <button
        type="button"
        onClick={() => onToggleCategory(category)}
        aria-controls={`category-${category}`}
        aria-expanded={isExpanded}
        className={[
          "w-full flex items-center justify-between gap-4 px-5 sm:px-6 py-4 sm:py-5",
          "bg-gradient-to-r from-pluto-50 to-pluto-100/50",
          "dark:from-pluto-900/30 dark:to-pluto-800/20",
          "hover:from-pluto-100 hover:to-pluto-200/50",
          "dark:hover:from-pluto-800/40 dark:hover:to-pluto-700/30",
          "transition-all duration-200 group",
          "focus-visible:ring-2 focus-visible:ring-pluto-500 focus-visible:ring-offset-2",
        ].join(" ")}
      >
        {/* Left Section: Icon + Label + Count */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex-shrink-0 p-2 sm:p-2.5 rounded-lg bg-pluto-500/10 dark:bg-pluto-400/20 text-pluto-600 dark:text-pluto-400 group-hover:bg-pluto-500/20 transition-colors"
          >
            {icon}
          </motion.div>
          <div className="flex flex-col items-start gap-1 min-w-0">
            <span className="text-sm sm:text-base font-bold uppercase tracking-wide text-pluto-900 dark:text-pluto-100">
              {label}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs sm:text-sm text-pluto-600 dark:text-pluto-400 font-medium">
                {grantedCount} of {totalCount} enabled
              </span>
              {/* Progress indicator */}
              <div className="hidden xs:flex items-center gap-1.5">
                <div className="w-16 sm:w-20 h-1.5 bg-pluto-200 dark:bg-pluto-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-pluto-500 to-pluto-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${(grantedCount / totalCount) * 100}%`,
                    }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    role="progressbar"
                    aria-valuenow={grantedCount}
                    aria-valuemin={0}
                    aria-valuemax={totalCount}
                    aria-label={`${grantedCount} of ${totalCount} permissions enabled`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Section: Expand Icon */}
        <div className="flex-shrink-0">
          <motion.svg
            className="h-5 w-5 sm:h-6 sm:w-6 text-pluto-600 dark:text-pluto-400 group-hover:text-pluto-700 dark:group-hover:text-pluto-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 9l-7 7-7-7"
            />
          </motion.svg>
        </div>
      </button>

      {/* Category Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.section
            id={`category-${category}`}
            role="region"
            aria-label={`${label} permissions`}
            variants={categoryVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="px-3 sm:px-5 py-2 bg-white dark:bg-pluto-900/10 border-t-2 border-pluto-100 dark:border-pluto-800 overflow-hidden"
          >
            <div role="list" className="space-y-1">
              <AnimatePresence initial={false}>
                {items.map((p) => (
                  <PermissionRow
                    key={p.id}
                    permission={p}
                    isPending={pendingIds.has(p.id)}
                    isReadOnly={isReadOnly}
                    onToggle={onTogglePermission}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- main component ----------

export function UserPermissionsManagerClient({
  userId: _userId,
  showCategories = false,
  isReadOnly = false,
  onPermissionsChange,
}: UserPermissionsManagerProps) {
  const t = useTranslations("permissions");
  const { permissions, setPermissions, isHydrated } = usePermissionsStore();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORY_ORDER),
  );

  const handleToggle = useCallback(
    async (permissionId: string) => {
      if (isReadOnly || pendingIds.has(permissionId)) return;

      const previous = permissions.map((p: Permission) => ({ ...p }));
      const updated = permissions.map((p: Permission) =>
        p.id === permissionId
          ? {
              ...p,
              granted: !p.granted,
              lastModified: new Date().toISOString(),
            }
          : p,
      );

      setPermissions(updated);
      setPendingIds((ids: Set<string>) => new Set(ids).add(permissionId));

      try {
        await onPermissionsChange?.(updated);
        toast.success(t("updateSuccess"));
      } catch {
        setPermissions(previous);
        toast.error(t("updateError"));
      } finally {
        setPendingIds((ids: Set<string>) => {
          const next = new Set(ids);
          next.delete(permissionId);
          return next;
        });
      }
    },
    [
      isReadOnly,
      pendingIds,
      permissions,
      setPermissions,
      onPermissionsChange,
      t,
    ],
  );

  const handleToggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  if (!isHydrated) {
    return <UserPermissionsManagerSkeleton loadingLabel={t("loading")} />;
  }

  return (
    <section
      role="region"
      aria-label={t("manager")}
      aria-busy={pendingIds.size > 0}
      className="flex flex-col gap-5 sm:gap-6 p-4 sm:p-6 bg-gradient-to-br from-pluto-50/50 to-white dark:from-pluto-900/10 dark:to-pluto-900/5 rounded-2xl border-2 border-pluto-100 dark:border-pluto-800"
    >
      {/* Header Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-pluto-900 dark:text-pluto-100 tracking-tight">
            {t("manager")}
          </h2>
          {pendingIds.size > 0 && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-pluto-600 bg-pluto-50 dark:bg-pluto-900/30 dark:text-pluto-400 rounded-full border border-pluto-200 dark:border-pluto-700"
              role="status"
              aria-live="polite"
            >
              <Spinner size="sm" className="h-4 w-4" />
              <span>Saving changes...</span>
            </motion.span>
          )}
        </div>

        {isReadOnly && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-4 text-sm bg-amber-50 dark:bg-amber-900/10 border-2 border-amber-200 dark:border-amber-800 rounded-xl"
            role="alert"
          >
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-amber-900 dark:text-amber-100">
                Read-Only Mode
              </p>
              <p className="text-amber-800 dark:text-amber-200">
                {t("readOnlyNotice")}
              </p>
            </div>
          </motion.div>
        )}
      </div>

      {/* Permissions List/Categories */}
      <div className="flex flex-col gap-4">
        {showCategories ? (
          CATEGORY_ORDER.map((category) => {
            const items = permissions.filter(
              (p: Permission) => p.category === category,
            );
            if (items.length === 0) return null;
            return (
              <CategorySection
                key={category}
                category={category}
                items={items}
                isExpanded={expandedCategories.has(category)}
                pendingIds={pendingIds}
                isReadOnly={isReadOnly}
                label={t(`category.${category}`)}
                onToggleCategory={handleToggleCategory}
                onTogglePermission={handleToggle}
              />
            );
          })
        ) : (
          <div
            className="bg-white dark:bg-pluto-900/10 rounded-xl border-2 border-pluto-200 dark:border-pluto-800 p-3 sm:p-4"
            role="list"
          >
            <div className="space-y-1">
              <AnimatePresence initial={false}>
                {permissions.map((p: Permission) => (
                  <PermissionRow
                    key={p.id}
                    permission={p}
                    isPending={pendingIds.has(p.id)}
                    isReadOnly={isReadOnly}
                    onToggle={handleToggle}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- loading state ----------

function UserPermissionsManagerSkeleton({
  loadingLabel,
}: {
  loadingLabel: string;
}) {
  return (
    <section
      role="region"
      aria-busy="true"
      aria-live="polite"
      className="flex flex-col gap-5 sm:gap-6 p-4 sm:p-6 bg-gradient-to-br from-pluto-50/50 to-white dark:from-pluto-900/10 dark:to-pluto-900/5 rounded-2xl border-2 border-pluto-100 dark:border-pluto-800 animate-pulse"
    >
      <span className="sr-only" role="status">
        {loadingLabel}
      </span>

      {/* Header skeleton */}
      <div className="h-8 w-48 rounded-lg bg-pluto-200/50 dark:bg-pluto-800/30" />

      {/* Permission rows skeleton */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-4 px-4 rounded-lg bg-white dark:bg-pluto-900/10 border-2 border-pluto-100 dark:border-pluto-800"
          >
            <div className="flex flex-col gap-2 flex-1 mr-4">
              <div className="h-4 w-32 rounded bg-pluto-200/60 dark:bg-pluto-800/40" />
              <div className="h-3 w-48 rounded bg-pluto-100/60 dark:bg-pluto-900/30" />
            </div>
            <div className="h-7 w-12 sm:h-8 sm:w-14 rounded-full bg-pluto-200/60 dark:bg-pluto-800/40" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default UserPermissionsManagerClient;
