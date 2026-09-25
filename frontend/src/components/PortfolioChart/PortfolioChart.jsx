import React, { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import './PortfolioChart.css';

// Note: This is a simplified chart component
// In a real implementation, you might use Recharts, Chart.js, or D3
// For testing purposes, we'll create a basic SVG-based chart

const RANGE_OPTIONS = ['1M', '3M', '6M', '1Y'];

const PortfolioChart = ({
  data = [],
  title = 'Portfolio Performance',
  loading = false,
  error = null,
  currency = 'USD',
  interactive = true,
  showLegend = true,
  onDataPointClick = null,
  onRangeChange = null,
  ariaLabel = 'Portfolio performance chart',
  height = 400,
  width = '100%',
  responsive = true,
  keyboardNavigation = true,
  announcementRegion = true,
  dateRangePicker = false
}) => {
  const [activePoint, setActivePoint] = useState(null);
  const [selectedRange, setSelectedRange] = useState('1Y');
  const [isMobile, setIsMobile] = useState(false);
  // Optimistic update state: true immediately when range changes, cleared when parent sends new data
  const [isPendingRange, setIsPendingRange] = useState(false);

  const announcementsRef = useRef(null);
  const isFirstRender = useRef(true);
  const chartId = useId();

  // Check for mobile viewport
  useEffect(() => {
    if (!responsive) return;

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [responsive]);

  // Reset pending state when parent delivers new data in response to range change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setIsPendingRange(false);
  }, [data]);

  // Format currency values
  const formatCurrency = useCallback((value) => {
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    }
    return `$${value.toLocaleString()}`;
  }, [currency]);

  // Find min and max values for scaling
  const { minValue, maxValue } = useMemo(() => {
    if (!data || data.length === 0) return { minValue: 0, maxValue: 100 };
    const values = data.map(d => d.value);
    return {
      minValue: Math.min(...values, 0),
      maxValue: Math.max(...values, 100)
    };
  }, [data]);

  // Calculate chart points for SVG rendering
  const chartPoints = useMemo(() => {
    if (!data || data.length === 0) return [];

    const w = isMobile ? 300 : 600;
    const height_val = isMobile ? 200 : 300;
    const padding = 40;
    const chartWidth = w - 2 * padding;
    const chartHeight = height_val - 2 * padding;

    return data.map((point, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight -
        ((point.value - minValue) / (maxValue - minValue)) * chartHeight;
      return { x, y, value: point.value, date: point.date, original: point };
    });
  }, [data, minValue, maxValue, isMobile]);

  // Concise text summary of chart data for screen readers
  const dataSummary = useMemo(() => {
    if (!data || data.length === 0) return '';
    const values = data.map(d => d.value);
    const first = data[0];
    const last = data[data.length - 1];
    return `${title}. Range: ${first.date} to ${last.date}. Min: ${formatCurrency(Math.min(...values))}, Max: ${formatCurrency(Math.max(...values))}, Latest: ${formatCurrency(last.value)}.`;
  }, [data, title, formatCurrency]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!keyboardNavigation || !interactive) return;

    let next = activePoint;
    if (e.key === 'ArrowRight') {
      if (activePoint === null && chartPoints.length > 0) next = 0;
      else if (activePoint !== null && activePoint < chartPoints.length - 1) next = activePoint + 1;
    } else if (e.key === 'ArrowLeft' && activePoint !== null && activePoint > 0) {
      next = activePoint - 1;
    } else {
      return;
    }

    if (next !== activePoint) {
      setActivePoint(next);
      if (announcementRegion && announcementsRef.current && next !== null) {
        announcementsRef.current.textContent =
          `Data point ${next + 1} of ${chartPoints.length}: ${chartPoints[next].date}, ${formatCurrency(chartPoints[next].value)}`;
      }
    }
  }, [keyboardNavigation, interactive, activePoint, chartPoints, formatCurrency, announcementRegion]);

  // Handle range selection — set optimistic pending state immediately
  const handleRangeChange = useCallback((range) => {
    setSelectedRange(range);
    setIsPendingRange(true);
    if (onRangeChange) {
      onRangeChange(range);
    }
  }, [onRangeChange]);

  // Loading state
  if (loading) {
    return (
      <div className="portfolio-chart loading" role="status" aria-label="Loading chart">
        <div className="loading-spinner"></div>
        <p>Loading chart data...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="portfolio-chart error" role="alert">
        <p>Error: {error}</p>
      </div>
    );
  }

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="portfolio-chart empty">
        <p>No portfolio data available</p>
      </div>
    );
  }

  return (
    <div
      className={`portfolio-chart ${isMobile ? 'mobile-view' : 'desktop-view'}`}
      data-testid="portfolio-chart"
      role="figure"
      aria-label={ariaLabel}
      aria-describedby={`${chartId}-summary`}
    >
      {/* Visually hidden data summary for screen readers */}
      <p id={`${chartId}-summary`} className="sr-only">{dataSummary}</p>

      {title && <h3 className="chart-title">{title}</h3>}

      {/* Date Range Picker */}
      {dateRangePicker && (
        <div className="range-picker" role="group" aria-label="Select date range">
          {RANGE_OPTIONS.map((range) => (
            <button
              key={range}
              onClick={() => handleRangeChange(range)}
              className={selectedRange === range ? 'active' : ''}
              aria-pressed={selectedRange === range}
            >
              {range}
            </button>
          ))}
        </div>
      )}

      {/* Chart Container — keyboard-focusable for arrow-key navigation */}
      <div
        className="chart-container"
        data-testid="chart-container"
        style={{
          height: isMobile ? '300px' : `${height}px`,
          opacity: isPendingRange ? 0.6 : 1,
          transition: 'opacity 0.2s ease',
        }}
        onKeyDown={handleKeyDown}
        tabIndex={keyboardNavigation ? 0 : -1}
        aria-label={keyboardNavigation ? 'Use left and right arrow keys to navigate data points' : undefined}
        aria-busy={isPendingRange}
      >
        {/* Pending overlay shown while parent fetches new range data */}
        {isPendingRange && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        )}

        {/* SVG is aria-hidden; the parent figure + summary provide the accessible label */}
        <svg
          width={width}
          height={isMobile ? 300 : height}
          viewBox={`0 0 ${isMobile ? 400 : 800} ${isMobile ? 300 : height}`}
          aria-hidden="true"
        >
          {/* Grid lines */}
          <g className="grid-lines">
            {[0, 25, 50, 75, 100].map((percent, i) => (
              <line
                key={i}
                x1="40"
                y1={40 + (percent / 100) * (isMobile ? 220 : 260)}
                x2={isMobile ? 360 : 760}
                y2={40 + (percent / 100) * (isMobile ? 220 : 260)}
                stroke="#e0e0e0"
                strokeDasharray="5,5"
              />
            ))}
          </g>

          {/* Chart line */}
          <polyline
            data-testid="chart-line"
            points={chartPoints.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4CAF50"
            strokeWidth="3"
          />

          {/* Data points */}
          {chartPoints.map((point, index) => (
            <circle
              key={index}
              data-testid={`data-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={activePoint === index ? 8 : 5}
              fill={activePoint === index ? '#ff5722' : '#4CAF50'}
              onMouseEnter={() => interactive && setActivePoint(index)}
              onMouseLeave={() => interactive && setActivePoint(null)}
              onClick={() => onDataPointClick && onDataPointClick(point.original)}
            />
          ))}

          {/* Labels */}
          <g className="labels">
            {chartPoints.map((point, index) => (
              <text
                key={index}
                x={point.x}
                y={isMobile ? 280 : 360}
                textAnchor="middle"
                fontSize="12"
              >
                {point.date}
              </text>
            ))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="chart-legend" data-testid="chart-legend">
          <div className="legend-item">
            <span className="legend-color"></span>
            <span>Portfolio Value</span>
          </div>
        </div>
      )}

      {/* Screen reader announcements — uses ref to avoid global ID conflicts */}
      {announcementRegion && (
        <div
          ref={announcementsRef}
          data-testid="sr-announcements"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        />
      )}

      {/* Tooltip for active point */}
      {activePoint !== null && chartPoints[activePoint] && interactive && (
        <div
          className="chart-tooltip"
          data-testid="chart-tooltip"
          role="tooltip"
          style={{
            position: 'absolute',
            left: `${chartPoints[activePoint].x}px`,
            top: `${chartPoints[activePoint].y - 30}px`
          }}
        >
          <strong>{chartPoints[activePoint].date}</strong>
          <br />
          {formatCurrency(chartPoints[activePoint].value)}
        </div>
      )}
    </div>
  );
};

export default PortfolioChart;
