import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LazyDocsSidebar from '@/components/DocsSidebar.lazy';
import DocsSidebarSkeleton from '@/components/DocsSidebarSkeleton';

// Mock the lazy load of DocsSidebar
vi.mock('@/components/DocsSidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="docs-sidebar">DocsSidebar Content</div>,
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
}));

describe('LazyDocsSidebar', () => {
  test('renders fallback skeleton while loading', async () => {
    render(<LazyDocsSidebar />);
    // Skeleton placeholders should be in the document initially
    const placeholders = screen.getAllByTestId('skeleton-item');
    expect(placeholders.length).toBeGreaterThanOrEqual(6);
    // Wait for the lazy component to appear
    await waitFor(() => {
      expect(screen.getByTestId('docs-sidebar')).toBeInTheDocument();
    });
  });
});

describe('DocsSidebarSkeleton', () => {
  test('renders placeholder elements', () => {
    render(<DocsSidebarSkeleton />);
    // Skeleton should have several placeholder divs
    const placeholders = screen.getAllByTestId('skeleton-item');
    expect(placeholders.length).toBeGreaterThanOrEqual(6);
  });
});
