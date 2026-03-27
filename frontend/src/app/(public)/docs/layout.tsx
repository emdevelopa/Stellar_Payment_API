import DocsSidebar from "@/components/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-10 lg:flex-row lg:items-start lg:py-16">
      <aside className="w-full lg:sticky lg:top-24 lg:w-80 lg:flex-shrink-0">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
            Docs
          </p>
          <h1 className="mt-3 text-2xl font-bold text-white">Integration Guides</h1>
          <p className="mt-2 text-sm text-slate-400">
            Built-in reference docs for onboarding merchants and integrators.
          </p>

          <div className="mt-6">
            <DocsSidebar />
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1">{children}</section>
    </main>
  );
}
