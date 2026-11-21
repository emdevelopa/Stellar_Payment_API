import React, { Suspense } from 'react';
import DocsSidebarSkeleton from './DocsSidebarSkeleton';

const DocsSidebar = React.lazy(() => import('./DocsSidebar'));

export default function LazyDocsSidebar() {
  return (
    <Suspense fallback={<DocsSidebarSkeleton />}>
      <DocsSidebar />
    </Suspense>
  );
}
