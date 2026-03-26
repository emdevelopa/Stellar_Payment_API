import DashboardTabs from "@/components/DashboardTabs";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-mint">
          Stellar Payment API
        </p>
        <h1 className="text-4xl font-semibold text-white sm:text-5xl">
          Accept XLM or USDC with clean payment links.
        </h1>
        <p className="max-w-2xl text-base text-slate-300">
          This dashboard is a starter shell for contributors. Hook it to the
          backend to create payment links, track confirmations, and trigger
          webhooks.
        </p>
      </header>

      <section className="grid gap-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-white">Getting Started</h2>
          <p className="text-sm text-slate-300">
            Follow these three steps to start accepting payments with Stellar
            links.
          </p>
        </div>
        <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="font-mono text-xs text-glow">Step 1</p>
            <p className="mt-2 font-medium text-white">Register</p>
            <p className="mt-1 text-slate-400">
              Create your merchant account to unlock the dashboard.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="font-mono text-xs text-glow">Step 2</p>
            <p className="mt-2 font-medium text-white">Create Link</p>
            <p className="mt-1 text-slate-400">
              Generate a payment link for the amount and asset you want to
              accept.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="font-mono text-xs text-glow">Step 3</p>
            <p className="mt-2 font-medium text-white">Share</p>
            <p className="mt-1 text-slate-400">
              Send the link to customers so they can pay instantly.
            </p>
          </div>
        </div>
      </section>

      <DashboardTabs />
    </main>
  );
}
