import DocsSidebar from "@/components/DocsSidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-10 lg:flex-row lg:items-start lg:gap-10 lg:py-16">
      {/* Sidebar */}
      <aside className="w-full lg:sticky lg:top-8 lg:w-72 lg:shrink-0">
        <div className="rounded-2xl border border-[#E8E8E8] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--pluto-500)]">
              <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B]">Documentation</p>
              <p className="text-sm font-bold text-[#0A0A0A]">PLUTO Guides</p>
            </div>
          </div>
          <DocsSidebar />
        </div>
      </aside>

      {/* Content */}
      <section className="min-w-0 flex-1">{children}</section>
    </main>
  );
}
