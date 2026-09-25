/**
 * Lazy-loaded TransactionFilterSidebar
 * Issue: Optimize client-side bundle size for Transaction Filter Sidebar
 *
 * This module provides a dynamic import for the TransactionFilterSidebar
 * component (and its framer-motion animations) to keep it out of the
 * initial payment-history page bundle. The sidebar is code-split and only
 * downloaded on the client, with a static skeleton shown while it loads.
 */

"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import TransactionFilterSidebarSkeleton from "./TransactionFilterSidebarSkeleton";

interface FilterState {
  search: string;
  status: string;
  asset: string;
  dateFrom: string;
  dateTo: string;
}

interface TransactionFilterSidebarProps {
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string) => void;
  onClearFilter: (key: keyof FilterState) => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  searchSyncPending?: boolean;
  isFilterPending?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const TransactionFilterSidebarComponent = dynamic(
  () => import("./TransactionFilterSidebar"),
  {
    loading: () => <TransactionFilterSidebarSkeleton />,
    ssr: false,
  },
) as ComponentType<TransactionFilterSidebarProps>;

export default TransactionFilterSidebarComponent;
