"use client";

import React, { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { usePermissionsStore } from "@/hooks/usePermissionsStore";

/**
 * Permission type for user access control
 */
interface Permission {
  id: string;
  name: string;
  description: string;
  granted: boolean;
  category: "payment" | "webhook" | "analytics" | "admin";
  lastModified?: Date;
}

/**
 * Props for the UserPermissionsManager component
 */
interface UserPermissionsManagerProps {
  userId: string;
  onPermissionsChange?: (permissions: Permission[]) => void | Promise<void>;
  isReadOnly?: boolean;
  showCategories?: boolean;
}

/**
 * Animation variants for permission items
 */
const itemVariants: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
};

/**
 * Animation variants for container
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

/**
 * Animation variants for toggle switch
 */
const toggleVariants: Variants = {
  unchecked: { backgroundColor: "#e5e7eb" },
  checked: {
    backgroundColor: "#10b981",
    transition: { duration: 0.2 },
  },
};

/**
 * Animation variants for category badge
 */
const badgeVariants: Variants = {
  initial: { scale: 0.8, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 260, damping: 20 },
  },
};

/**
 * UserPermissionsManager Component
 *
 * Displays and manages user permissions with framer-motion animations.
 * Provides a smooth UX for toggling permissions by category.
 * Includes change tracking and accessibility features.
 */
export const UserPermissionsManager: React.FC<UserPermissionsManagerProps> =
  ({
    userId,
    onPermissionsChange,
    isReadOnly = false,
    showCategories = true,
  }) => {
    const t = useTranslations();
    const { permissions, togglePermission } = usePermissionsStore();

    const [expandedCategory, setExpandedCategory] = useState<string | null>(
      "payment"
    );

    /**
     * Handle permission toggle with optimistic updates
     */
    const handlePermissionChange = useCallback(
      async (permissionId: string) => {
        if (isReadOnly) {
          toast.error(t("permissions.readOnly") || "Read-only mode");
          return;
        }

        // Optimistically update local state (Zustand update is synchronous)
        const previousPermission = permissions.find(p => p.id === permissionId);
        togglePermission(permissionId);

        try {
          // Attempt to update permissions via callback
          const updatedPermissions = usePermissionsStore.getState().permissions;
          await onPermissionsChange?.(updatedPermissions as any);

          // Show success toast if no error
          toast.success(
            t("permissions.updated") || "Permission updated successfully"
          );
        } catch (error) {
          // Revert optimistic update on error
          if (previousPermission) {
            togglePermission(permissionId); // Toggling again reverts it
          }

          toast.error(
            t("permissions.updateFailed") || "Failed to update permission. Please try again."
          );

          console.error("Permission update failed:", error);
        }
      },
      [isReadOnly, permissions, togglePermission, onPermissionsChange, t]
    );

    /**
     * Group permissions by category
     */
    const groupedPermissions = useMemo(() => {
      const groups: Record<string, Permission[]> = {
        payment: [],
        webhook: [],
        analytics: [],
        admin: [],
      };

      permissions.forEach((perm) => {
        groups[perm.category as string].push(perm as any);
      });

      return groups;
    }, [permissions]);

    /**
     * Get category label
     */
    const getCategoryLabel = (category: string): string => {
      const labels: Record<string, string> = {
        payment: t("permissions.category.payment") || "Payment",
        webhook: t("permissions.category.webhook") || "Webhook",
        analytics: t("permissions.category.analytics") || "Analytics",
        admin: t("permissions.category.admin") || "Admin",
      };
      return labels[category] || category;
    };

    /**
     * Get category color
     */
    const getCategoryColor = (category: string): string => {
      const colors: Record<string, string> = {
        payment: "bg-blue-100 text-blue-800",
        webhook: "bg-purple-100 text-purple-800",
        analytics: "bg-yellow-100 text-yellow-800",
        admin: "bg-red-100 text-red-800",
      };
      return colors[category] || "bg-gray-100 text-gray-800";
    };

    return (
      <div
        className="w-full rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        role="region"
        aria-label={t("permissions.manager") || "User Permissions Manager"}
      >
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {t("permissions.title") || "Permissions"}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {t("permissions.subtitle") ||
              "Manage access permissions for this user"}
          </p>
          {isReadOnly && (
            <p className="mt-2 text-sm text-amber-600">
              {t("permissions.readOnlyNotice") || "These permissions are read-only"}
            </p>
          )}
        </div>

        {showCategories ? (
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence mode="popLayout">
              {Object.entries(groupedPermissions).map(
                ([category, categoryPerms]) => {
                  if (categoryPerms.length === 0) return null;

                  const isExpanded = expandedCategory === category;

                  return (
                    <motion.div
                      key={category}
                      className="overflow-hidden rounded border border-gray-200 bg-gray-50"
                      variants={itemVariants}
                    >
                      <button
                        onClick={() =>
                          setExpandedCategory(
                            isExpanded ? null : category
                          )
                        }
                        className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        aria-expanded={isExpanded}
                        aria-controls={`category-${category}`}
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            animate={{
                              rotate: isExpanded ? 180 : 0,
                            }}
                            transition={{ duration: 0.2 }}
                            className="flex-shrink-0"
                          >
                            <svg
                              className="h-5 w-5 text-gray-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 14l-7 7m0 0l-7-7m7 7V3"
                              />
                            </svg>
                          </motion.div>
                          <motion.span
                            className={`text-sm font-medium ${getCategoryColor(category)} rounded px-2 py-1`}
                            variants={badgeVariants}
                            initial="initial"
                            animate="animate"
                          >
                            {getCategoryLabel(category)}
                          </motion.span>
                          <span className="text-xs text-gray-600">
                            {categoryPerms.filter((p) => p.granted).length} of{" "}
                            {categoryPerms.length}
                          </span>
                        </div>
                        <svg
                          className="h-5 w-5 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            id={`category-${category}`}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="border-t border-gray-200"
                          >
                            <div className="space-y-2 px-4 py-3">
                              <AnimatePresence mode="popLayout">
                                {categoryPerms.map((permission) => (
                                  <motion.div
                                    key={permission.id}
                                    className="flex items-center justify-between rounded px-2 py-2 hover:bg-white"
                                    variants={itemVariants}
                                    initial="hidden"
                                    animate="visible"
                                    exit="exit"
                                  >
                                    <div className="flex-1">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={permission.granted}
                                          onChange={() =>
                                            handlePermissionChange(
                                              permission.id
                                            )
                                          }
                                          disabled={isReadOnly}
                                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                                          aria-label={permission.name}
                                          aria-describedby={`desc-${permission.id}`}
                                        />
                                        <div>
                                          <p className="font-medium text-sm text-gray-700">
                                            {permission.name}
                                          </p>
                                          <p
                                            id={`desc-${permission.id}`}
                                            className="text-xs text-gray-500"
                                          >
                                            {permission.description}
                                          </p>
                                        </div>
                                      </label>
                                    </div>
                                    {permission.lastModified && (
                                      <motion.span
                                        className="text-xs text-gray-400 ml-2"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2 }}
                                      >
                                        {new Date(
                                          permission.lastModified
                                        ).toLocaleDateString()}
                                      </motion.span>
                                    )}
                                  </motion.div>
                                ))}
                              </AnimatePresence>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                }
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            className="space-y-3"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence mode="popLayout">
              {permissions.map((permission) => (
                <motion.div
                  key={permission.id}
                  className="flex items-center justify-between rounded border border-gray-200 px-4 py-3 hover:bg-gray-50"
                  variants={itemVariants}
                >
                  <div className="flex-1">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={permission.granted}
                        onChange={() => handlePermissionChange(permission.id)}
                        disabled={isReadOnly}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                        aria-label={permission.name}
                        aria-describedby={`desc-flat-${permission.id}`}
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          {permission.name}
                        </p>
                        <p
                          id={`desc-flat-${permission.id}`}
                          className="text-sm text-gray-500"
                        >
                          {permission.description}
                        </p>
                      </div>
                    </label>
                  </div>
                  <motion.span
                    className={`inline-flex rounded px-2 py-1 text-xs font-medium ${getCategoryColor(permission.category)}`}
                    variants={badgeVariants}
                    initial="initial"
                    animate="animate"
                  >
                    {getCategoryLabel(permission.category)}
                  </motion.span>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    );
  };

export default UserPermissionsManager;
