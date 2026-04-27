import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Permission {
  id: string;
  name: string;
  description: string;
  granted: boolean;
  category: "payment" | "webhook" | "analytics" | "admin";
  lastModified?: string;
}

interface PermissionsState {
  permissions: Permission[];
  setPermissions: (permissions: Permission[]) => void;
  togglePermission: (id: string) => void;
  getPermissionsByCategory: (category: Permission["category"]) => Permission[];
  isAllGranted: (category?: Permission["category"]) => boolean;
}

export const usePermissionsStore = create<PermissionsState>()(
  persist(
    (set, get) => ({
      permissions: [
        {
          id: "payment-read",
          name: "View Payments",
          description: "View all payments",
          granted: true,
          category: "payment",
        },
        {
          id: "payment-write",
          name: "Create Payments",
          description: "Create new payments",
          granted: false,
          category: "payment",
        },
        {
          id: "webhook-read",
          name: "View Webhooks",
          description: "View webhook configurations",
          granted: true,
          category: "webhook",
        },
        {
          id: "webhook-write",
          name: "Manage Webhooks",
          description: "Create and modify webhooks",
          granted: false,
          category: "webhook",
        },
        {
          id: "analytics-read",
          name: "View Analytics",
          description: "View analytics data",
          granted: true,
          category: "analytics",
        },
        {
          id: "admin-access",
          name: "Admin Access",
          description: "Full system administration",
          granted: false,
          category: "admin",
        },
      ],

      setPermissions: (permissions) => set({ permissions }),

      togglePermission: (id) =>
        set((state) => ({
          permissions: state.permissions.map((p) =>
            p.id === id
              ? { ...p, granted: !p.granted, lastModified: new Date().toISOString() }
              : p
          ),
        })),

      getPermissionsByCategory: (category) => {
        return get().permissions.filter((p) => p.category === category);
      },

      isAllGranted: (category) => {
        const perms = category
          ? get().permissions.filter((p) => p.category === category)
          : get().permissions;
        return perms.every((p) => p.granted);
      },
    }),
    {
      name: "user-permissions-storage",
    }
  )
);
