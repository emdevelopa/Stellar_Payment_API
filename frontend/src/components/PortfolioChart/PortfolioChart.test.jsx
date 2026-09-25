import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import PortfolioChart from './PortfolioChart';

expect.extend(toHaveNoViolations);

// Mock data
const mockData = [
  { date: 'Jan', value: 1000 },
  { date: 'Feb', value: 1500 },
  { date: 'Mar', value: 1200 },
  { date: 'Apr', value: 1800 },
];

describe('PortfolioChart Widget', () => {
  describe('Rendering Tests', () => {
    test('renders without crashing', () => {
      render(<PortfolioChart data={mockData} />);
      expect(screen.getByTestId('portfolio-chart')).toBeInTheDocument();
    });

    test('shows loading state when loading prop is true', () => {
      render(<PortfolioChart data={[]} loading={true} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/loading chart data/i)).toBeInTheDocument();
    });

    test('shows error message when error occurs', () => {
      const errorMessage = 'Failed to load portfolio data';
      render(<PortfolioChart data={[]} error={errorMessage} />);
      expect(screen.getByText(`Error: ${errorMessage}`)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    test('shows empty state when no data is provided', () => {
      render(<PortfolioChart data={[]} />);
      expect(screen.getByText(/no portfolio data available/i)).toBeInTheDocument();
    });

    test('displays title when title prop is provided', () => {
      const title = 'Portfolio Performance 2024';
      render(<PortfolioChart data={mockData} title={title} />);
      expect(screen.getByText(title)).toBeInTheDocument();
    });
  });

  describe('Interactive Behavior Tests', () => {
    test('tooltip shows on hover', async () => {
      render(<PortfolioChart data={mockData} interactive={true} />);
      const dataPoint = screen.getByTestId('data-point-0');
      
      fireEvent.mouseEnter(dataPoint);
      
      await waitFor(() => {
        const tooltip = screen.getByTestId('chart-tooltip');
        expect(tooltip).toBeInTheDocument();
      });
    });

    test('click handler works when provided', async () => {
      const onDataPointClick = jest.fn();
      render(<PortfolioChart data={mockData} onDataPointClick={onDataPointClick} />);
      
      const dataPoint = screen.getByTestId('data-point-0');
      await userEvent.click(dataPoint);
      
      expect(onDataPointClick).toHaveBeenCalledTimes(1);
      expect(onDataPointClick).toHaveBeenCalledWith(expect.objectContaining({
        value: 1000,
        date: 'Jan'
      }));
    });

    test('range picker buttons work', async () => {
      const onRangeChange = jest.fn();
      render(<PortfolioChart data={mockData} onRangeChange={onRangeChange} dateRangePicker={true} />);
      
      const rangeButton = screen.getByText('6M');
      await userEvent.click(rangeButton);
      
      expect(onRangeChange).toHaveBeenCalledWith('6M');
    });
  });

  describe('Accessibility Tests', () => {
    test('has no accessibility violations', async () => {
      const { container } = render(<PortfolioChart data={mockData} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    test('provides ARIA labels', () => {
      render(<PortfolioChart data={mockData} ariaLabel="Portfolio chart" />);
      expect(screen.getByRole('figure')).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior Tests', () => {
    test('adds mobile-view class on small screens', () => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event('resize'));
      
      render(<PortfolioChart data={mockData} responsive={true} />);
      expect(screen.getByTestId('portfolio-chart')).toHaveClass('mobile-view');
    });
  });
});