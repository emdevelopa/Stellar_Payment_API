import DocsSidebar from "@/components/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-12 px-6 py-10 lg:flex-row lg:items-start lg:py-16">
      <aside className="w-full lg:sticky lg:top-24 lg:w-80 lg:flex-shrink-0">
        <div className="rounded-[2.5rem] border border-[#E8E8E8] bg-white p-10 shadow-[0_20px_50px_rgba(0,0,0,0.04)]">
          <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
            Library
          </p>
          <h1 className="mt-4 text-3xl font-bold text-[#0A0A0A] font-serif tracking-tight uppercase">Full Guides</h1>
          <p className="mt-4 text-sm font-medium leading-relaxed text-[#6B6B6B]">
            High-precision reference for scaling your merchant connectivity.
          </p>

          <div className="mt-10 pt-10 border-t border-[#E8E8E8]">
            <DocsSidebar />
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1">{children}</section>
    </main>
  );
}
