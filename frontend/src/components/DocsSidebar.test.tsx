import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocsSidebar from '@/components/DocsSidebar';
import '@testing-library/jest-dom';

vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
}));

describe('DocsSidebar', () => {
  test('renders overview link and docs list', () => {
    render(<DocsSidebar />);
    expect(screen.getByRole('link', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /subscription api guide/i })).toBeInTheDocument();
  });

  test('search filters items', () => {
    render(<DocsSidebar />);
    const search = screen.getByPlaceholderText(/search…/i);
    fireEvent.change(search, { target: { value: 'hmac' } });
    expect(screen.getByRole('link', { name: /how to verify hmac signatures/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /subscription api guide/i })).not.toBeInTheDocument();
  });

  test('keyboard navigation works', async () => {
    render(<DocsSidebar />);
    const list = screen.getByRole('list');
    // focus first link
    const firstLink = screen.getAllByRole('link')[0];
    firstLink.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitFor(() => {
      const secondLink = screen.getAllByRole('link')[1];
      expect(document.activeElement).toBe(secondLink);
    });
  });
});
