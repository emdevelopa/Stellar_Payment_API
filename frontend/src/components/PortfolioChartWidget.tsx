'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { localeToLanguageTag } from '@/i18n/config';

export interface PortfolioAsset {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  value: number;
  percentage: number;
  color?: string;
}

export interface PortfolioHistoryPoint {
  timestamp: number;
  value: number;
}

export interface PortfolioChartProps {
  assets: PortfolioAsset[];
  totalValue: number;
  currency?: string;
  showAnimation?: boolean;
  loading?: boolean;
  historyData?: PortfolioHistoryPoint[];
  historyLoading?: boolean;
  error?: string | null;
  onAssetClick?: (asset: PortfolioAsset) => void;
  className?: string;
}

const DEFAULT_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
];

/**
 * PortfolioChartWidget - A responsive portfolio visualization component
 * Displays asset allocation with pie chart and includes state management
 */
export function PortfolioChartWidget({
  assets = [],
  totalValue = 0,
  currency = 'USD',
  showAnimation = true,
  loading = false,
  historyData = [],
  historyLoading = false,
  error = null,
  onAssetClick,
  className = '',
}: PortfolioChartProps) {
  const t = useTranslations('portfolioChartWidget');
  const locale = localeToLanguageTag(useLocale());
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'pie' | 'history'>('pie');

  const assetsWithColors = useMemo(() => {
    return assets.map((asset, index) => ({
      ...asset,
      color: asset.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    }));
  }, [assets]);

  const pieData = useMemo(() => {
    return assetsWithColors.map((asset) => ({
      name: asset.symbol,
      value: asset.value,
      payload: asset,
    }));
  }, [assetsWithColors]);

  const historyChartData = useMemo(() => {
    return historyData.map((point) => ({
      ...point,
      label: new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
      }).format(new Date(point.timestamp)),
    }));
  }, [historyData, locale]);

  const handleAssetClick = useCallback(
    (asset: PortfolioAsset) => {
      setSelectedAsset(asset.id === selectedAsset ? null : asset.id);
      onAssetClick?.(asset);
    },
    [selectedAsset, onAssetClick]
  );

  const formatCurrency = useCallback(
    (value: number) => {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    },
    [currency, locale]
  );

  const formatCompactCurrency = useCallback(
    (value: number) => {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: 'compact',
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(value);
    },
    [currency, locale]
  );

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 100,
        damping: 15,
      },
    },
  };

  const isChartLoading = loading || (chartType === 'history' && historyLoading);
  const hasAssets = assetsWithColors.length > 0;
  const hasHistoryData = historyChartData.length > 0;

  return (
    <motion.div
      className={`w-full h-full flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`}
      variants={containerVariants}
      initial={showAnimation ? 'hidden' : 'visible'}
      animate="visible"
      aria-busy={isChartLoading}
    >
      <motion.div variants={itemVariants} className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t('title')}
          </h2>
          <p className="mt-1 text-3xl font-bold text-blue-600 dark:text-blue-400">
            {formatCurrency(totalValue)}
          </p>
        </div>
        <div className="flex gap-2">
          <motion.button
            whileHover={isChartLoading ? undefined : { scale: 1.05 }}
            whileTap={isChartLoading ? undefined : { scale: 0.95 }}
            onClick={() => setChartType('pie')}
            disabled={isChartLoading}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              chartType === 'pie'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            } ${isChartLoading ? 'cursor-not-allowed opacity-60' : ''}`}
            aria-pressed={chartType === 'pie'}
          >
            {t('allocation')}
          </motion.button>
          <motion.button
            whileHover={isChartLoading ? undefined : { scale: 1.05 }}
            whileTap={isChartLoading ? undefined : { scale: 0.95 }}
            onClick={() => setChartType('history')}
            disabled={isChartLoading}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              chartType === 'history'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            } ${isChartLoading ? 'cursor-not-allowed opacity-60' : ''}`}
            aria-pressed={chartType === 'history'}
          >
            {t('trend')}
          </motion.button>
        </div>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="relative flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-md bg-gray-50 dark:bg-gray-800"
      >
        {isChartLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 text-gray-700 backdrop-blur-sm dark:bg-gray-900/80 dark:text-gray-200"
            role="status"
            aria-live="polite"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400" />
            <p className="text-sm font-medium">
              {chartType === 'history' && historyLoading ? t('historyLoading') : t('loading')}
            </p>
          </div>
        )}

        {error ? (
          <div
            className="mx-4 w-full rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        ) : chartType === 'pie' && !hasAssets && !loading ? (
          <p className="px-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('emptyAllocation')}
          </p>
        ) : chartType === 'history' && !hasHistoryData && !historyLoading ? (
          <p className="px-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('emptyHistory')}
          </p>
        ) : (
          <AnimatePresence mode="wait">
            {chartType === 'pie' ? (
              <motion.div
                key="pie-chart"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`flex h-full w-full items-center justify-center ${isChartLoading ? 'pointer-events-none opacity-40' : ''}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={120}
                      paddingAngle={2}
                      isAnimationActive={showAnimation}
                      animationDuration={800}
                      onClick={(entry) => handleAssetClick(entry.payload.payload)}
                    >
                      {assetsWithColors.map((asset) => (
                        <Cell
                          key={`cell-${asset.id}`}
                          fill={asset.color}
                          className={`cursor-pointer transition-opacity ${
                            selectedAsset === null || selectedAsset === asset.id
                              ? 'opacity-100'
                              : 'opacity-40'
                          }`}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value as number)}
                      contentStyle={{
                        backgroundColor: '#1F2937',
                        border: '1px solid #374151',
                        borderRadius: '0.375rem',
                        color: '#F3F4F6',
                      }}
                    />
                    <Legend
                      formatter={(value, entry) => {
                        const asset = (entry as { payload: { payload: PortfolioAsset } }).payload.payload;
                        return `${asset.symbol} (${asset.percentage.toFixed(1)}%)`;
                      }}
                      wrapperStyle={{ paddingTop: '20px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </motion.div>
            ) : (
              <motion.div
                key="history-chart"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`flex h-full w-full items-center justify-center p-4 ${isChartLoading ? 'pointer-events-none opacity-40' : ''}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(value: number) => formatCompactCurrency(value)} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value as number)}
                      contentStyle={{
                        borderRadius: '0.375rem',
                        border: '1px solid #E5E7EB',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#3B82F6"
                      isAnimationActive={showAnimation}
                      animationDuration={800}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      <motion.div variants={itemVariants} className="max-h-[200px] space-y-2 overflow-y-auto">
        {loading && !hasAssets ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`portfolio-chart-skeleton-${index}`}
              className="flex items-center gap-3 rounded-md bg-gray-50 p-3 dark:bg-gray-800"
              aria-hidden="true"
            >
              <div className="h-3 w-3 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          ))
        ) : !hasAssets ? (
          <p className="rounded-md bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {t('emptyAssets')}
          </p>
        ) : (
          assetsWithColors.map((asset) => (
            <motion.div
              key={asset.id}
              onClick={() => !isChartLoading && handleAssetClick(asset)}
              className={`flex cursor-pointer items-center gap-3 rounded-md p-3 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                selectedAsset === asset.id
                  ? 'border border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                  : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700'
              } ${isChartLoading ? 'pointer-events-none opacity-60' : ''}`}
              whileHover={isChartLoading ? undefined : { x: 4 }}
              whileTap={isChartLoading ? undefined : { scale: 0.98 }}
              role="button"
              tabIndex={isChartLoading ? -1 : 0}
              aria-pressed={selectedAsset === asset.id}
              onKeyDown={(e) => {
                if (!isChartLoading && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleAssetClick(asset);
                }
              }}
            >
              <motion.div
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: asset.color }}
                whileHover={isChartLoading ? undefined : { scale: 1.3 }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {asset.symbol}
                  </span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {asset.percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {asset.amount.toFixed(4)} {asset.symbol}
                  </span>
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {formatCurrency(asset.value)}
                  </span>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  );
}

export default PortfolioChartWidget;