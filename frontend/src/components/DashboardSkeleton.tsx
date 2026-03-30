"use client";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";

export default function DashboardSkeleton() {
  return (
    <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <Skeleton width={300} height={40} borderRadius={8} />
          <Skeleton width="100%" height={20} style={{ maxWidth: 600 }} borderRadius={4} />
        </header>

        <div className="grid gap-10 lg:grid-cols-3">
          <div className="flex flex-col gap-10 lg:col-span-2">
            {/* Metrics Section */}
            <section className="flex flex-col gap-4">
              <Skeleton width={180} height={28} borderRadius={6} />
              <div className="grid gap-4 sm:grid-cols-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                    <Skeleton width={126} height={14} borderRadius={4} />
                    <div className="mt-2 flex items-baseline gap-2">
                      <Skeleton width={132} height={36} borderRadius={6} />
                      <Skeleton width={56} height={20} borderRadius={4} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Chart Container */}
              <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <Skeleton width={240} height={24} borderRadius={6} />
                    <Skeleton width={180} height={16} borderRadius={4} />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton width={100} height={32} borderRadius={8} />
                    <Skeleton width={140} height={32} borderRadius={8} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Skeleton width={60} height={24} borderRadius={12} />
                  <Skeleton width={60} height={24} borderRadius={12} />
                </div>
                <div className="h-[300px]">
                  <Skeleton height="100%" borderRadius={8} />
                </div>
              </div>
            </section>

            {/* Recent Activity Section */}
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <Skeleton width={150} height={28} borderRadius={6} />
                <Skeleton width={120} height={20} borderRadius={4} />
              </div>
              
              <div className="flex flex-col gap-4">
                {/* Search and Filters Skeleton */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <Skeleton width={60} height={14} borderRadius={4} />
                      <Skeleton height={40} borderRadius={12} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex flex-col gap-2">
                          <Skeleton width={60} height={14} borderRadius={4} />
                          <Skeleton height={40} borderRadius={12} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Table Skeleton */}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <div className="border-b border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex justify-between">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} width={80} height={14} borderRadius={4} />
                      ))}
                    </div>
                  </div>
                  <div className="divide-y divide-white/5">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="px-4 py-4">
                        <div className="flex justify-between items-center">
                          <Skeleton width={70} height={24} borderRadius={999} />
                          <Skeleton width={100} height={20} borderRadius={4} />
                          <Skeleton width={120} height={16} borderRadius={4} className="hidden sm:block" />
                          <Skeleton width={80} height={16} borderRadius={4} className="hidden md:block" />
                          <Skeleton width={60} height={16} borderRadius={4} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar Skeleton */}
          <aside className="flex flex-col gap-8">
            {[...Array(2)].map((_, i) => (
              <section key={i} className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <Skeleton width={120} height={24} borderRadius={6} className="mb-4" />
                <div className="flex flex-col gap-3">
                  <Skeleton height={44} borderRadius={12} />
                  <Skeleton height={44} borderRadius={12} />
                </div>
              </section>
            ))}
          </aside>
        </div>
      </div>
    </SkeletonTheme>
  );
}
