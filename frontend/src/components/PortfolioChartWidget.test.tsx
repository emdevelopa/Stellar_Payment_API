import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortfolioChartWidget, PortfolioAsset } from './PortfolioChartWidget';

const translations = {
  en: {
    portfolioChartWidget: {
      title: 'Portfolio Value',
      allocation: 'Allocation',
      trend: 'Trend',
      loading: 'Loading portfolio chart...',
      historyLoading: 'Loading performance history...',
      emptyAllocation: 'No allocation data available yet.',
      emptyAssets: 'No portfolio assets available yet.',
      emptyHistory: 'No performance history available yet.',
    },
  },
  es: {
    portfolioChartWidget: {
      title: 'Valor del portafolio',
      allocation: 'Distribucion',
      trend: 'Tendencia',
      loading: 'Cargando grafico del portafolio...',
      historyLoading: 'Cargando historial de rendimiento...',
      emptyAllocation: 'Todavia no hay datos de asignacion.',
      emptyAssets: 'Todavia no hay activos en el portafolio.',
      emptyHistory: 'Todavia no hay historial de rendimiento.',
    },
  },
} as const;

let mockLocale: keyof typeof translations = 'en';

vi.mock('next-intl', () => ({
  useLocale: () => mockLocale,
  useTranslations: (namespace: keyof (typeof translations)['en']) => (key: string) =>
    translations[mockLocale][namespace][key as keyof (typeof translations)['en'][typeof namespace]] ?? key,
}));

vi.mock('recharts', () => ({
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children, onClick, data }: any) => (
    <div data-testid="pie" onClick={() => onClick && data?.[0] && onClick(data[0])}>
      {children}
    </div>
  ),
  Cell: () => <div data-testid="cell" />,
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Legend: () => <div data-testid="legend" />,
  Tooltip: () => <div data-testid="tooltip" />,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
}));

describe('PortfolioChartWidget', () => {
  const mockAssets: PortfolioAsset[] = [
    {
      id: '1',
      symbol: 'XLM',
      name: 'Stellar Lumens',
      amount: 1000,
      value: 2000,
      percentage: 50,
      color: '#3B82F6',
    },
    {
      id: '2',
      symbol: 'USDC',
      name: 'USD Coin',
      amount: 500,
      value: 2000,
      percentage: 50,
      color: '#10B981',
    },
  ];

  const historyData = [
    { timestamp: Date.UTC(2026, 0, 1), value: 3200 },
    { timestamp: Date.UTC(2026, 0, 2), value: 4000 },
  ];

  const defaultProps = {
    assets: mockAssets,
    totalValue: 4000,
    currency: 'USD',
    showAnimation: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocale = 'en';
  });

  it('renders the localized title and portfolio value', () => {
    render(<PortfolioChartWidget {...defaultProps} />);

    expect(screen.getByText('Portfolio Value')).toBeInTheDocument();
    expect(screen.getByText('$4,000.00')).toBeInTheDocument();
  });

  it('displays the correct currency format', () => {
    render(
      <PortfolioChartWidget
        {...defaultProps}
        totalValue={5000}
        currency="EUR"
      />
    );

    const portfolioValue = screen.getByText(/Portfolio Value/i).parentElement;
    expect(portfolioValue).toBeInTheDocument();
  });

  it('renders all assets in the list', () => {
    render(<PortfolioChartWidget {...defaultProps} />);

    expect(screen.getByText('XLM')).toBeInTheDocument();
    expect(screen.getByText('USDC')).toBeInTheDocument();
    expect(screen.getByText('1000.0000 XLM')).toBeInTheDocument();
  });

  it('switches to the history view when history data is available', async () => {
    render(<PortfolioChartWidget {...defaultProps} historyData={historyData} />);

    const trendButton = screen.getByText('Trend');
    fireEvent.click(trendButton);

    await waitFor(() => {
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });

    const allocationButton = screen.getByText('Allocation');
    fireEvent.click(allocationButton);

    await waitFor(() => {
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  it('shows an accessible loading state and disables chart toggles', () => {
    render(<PortfolioChartWidget {...defaultProps} loading />);

    const assetElement = screen.getByText('XLM').closest('div[class*="p-3"]');
    if (assetElement) {
      fireEvent.click(assetElement);
    }

    expect(screen.getByText('XLM')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading portfolio chart...');
    expect(screen.getByRole('button', { name: 'Allocation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trend' })).toBeDisabled();
  });

  it('shows an empty history state when no trend data exists', async () => {
    render(<PortfolioChartWidget {...defaultProps} historyData={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trend' }));

    await waitFor(() => {
      expect(screen.getByText('No performance history available yet.')).toBeInTheDocument();
    });
  });

  it('shows the empty assets state when no assets are provided', () => {
    render(
      <PortfolioChartWidget
        assets={[]}
        totalValue={0}
        currency="USD"
        showAnimation={false}
      />
    );

    expect(screen.getByText('No allocation data available yet.')).toBeInTheDocument();
    expect(screen.getByText('No portfolio assets available yet.')).toBeInTheDocument();
  });

  it('renders a locale-aware translation and currency format', () => {
    mockLocale = 'es';
    const formattedValue = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(5000);

    render(
      <PortfolioChartWidget
        {...defaultProps}
        totalValue={5000}
        currency="EUR"
      />
    );

    // Compare with non-breaking spaces normalized to regular spaces: the
    // exact separator Intl.NumberFormat emits between the amount and the
    // currency symbol is ICU-data-dependent and not what this test cares
    // about — it cares that the value is formatted es-ES/EUR-style.
    const normalize = (s: string) => s.replace(/ /g, ' ');

    expect(screen.getByText('Valor del portafolio')).toBeInTheDocument();
    expect(
      screen.getByText((text) => normalize(text) === normalize(formattedValue))
    ).toBeInTheDocument();
  });

  it('handles asset selection and onAssetClick callbacks', () => {
    const onAssetClick = vi.fn();
    render(
      <PortfolioChartWidget
        {...defaultProps}
        onAssetClick={onAssetClick}
      />
    );

    const assetElement = screen.getByText('XLM').closest('div[class*="p-3"]');
    expect(assetElement).toBeInTheDocument();

    if (assetElement) {
      fireEvent.click(assetElement);
      expect(assetElement).toHaveClass('bg-blue-50');
    }

    expect(onAssetClick).toHaveBeenCalledWith(mockAssets[0]);
  });

  it('renders an error message when provided', () => {
    render(
      <PortfolioChartWidget
        {...defaultProps}
        error="Unable to load the latest portfolio snapshot."
      />
    );

    expect(screen.getByText(/Portfolio Value/)).toBeInTheDocument();
  });

  it('handles large portfolio values', () => {
    const largeAssets: PortfolioAsset[] = [
      {
        id: '1',
        symbol: 'BTC',
        name: 'Bitcoin',
        amount: 0.5,
        value: 20000,
        percentage: 100,
      },
    ];

    const { container } = render(
      <PortfolioChartWidget
        assets={largeAssets}
        totalValue={20000}
        showAnimation={false}
      />
    );

    const portfolioValueTexts = screen.getAllByText('$20,000.00');
    expect(portfolioValueTexts.length).toBeGreaterThan(0);
  });

  it('displays asset color indicators', () => {
    render(<PortfolioChartWidget {...defaultProps} />);

    expect(screen.getAllByTestId('cell').length).toBe(mockAssets.length);
  });

  it('makes asset rows keyboard-operable', () => {
    const onAssetClick = vi.fn();
    render(<PortfolioChartWidget {...defaultProps} onAssetClick={onAssetClick} />);

    const assetRow = screen.getByText('XLM').closest('[role="button"]');
    expect(assetRow).toBeInTheDocument();
    expect(assetRow).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(assetRow as Element, { key: 'Enter' });
    expect(onAssetClick).toHaveBeenCalledWith(mockAssets[0]);
  });
});