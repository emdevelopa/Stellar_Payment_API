import React from 'react';

export default function DocsSidebarSkeleton() {
  return (
    <nav aria-label="Documentation sidebar loading" className="flex flex-col gap-1 animate-pulse">
      <div data-testid="skeleton-item" className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      {[...Array(5)].map((_, i) => (
        <div key={i} data-testid="skeleton-item" className="h-3 bg-gray-200 rounded w-full mb-1" />
      ))}
    </nav>
  );
}
