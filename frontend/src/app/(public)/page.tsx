import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <header className="flex flex-col items-center gap-4">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-mint">
          Stellar Payment API
        </p>
        <h1 className="max-w-3xl text-5xl font-bold leading-tight text-white sm:text-6xl lg:text-7xl">
          Accept Crypto Payments with <span className="bg-gradient-to-r from-mint to-cyan-400 bg-clip-text text-transparent">Zero Friction.</span>
        </h1>
        <p className="max-w-2xl text-lg text-slate-400">
          The simplest way for merchants to accept XLM and USDC on the Stellar network. 
          Generate payment links, track confirmations, and scale your business.
        </p>
      </header>

      <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <Link
          href="/register"
          className="group relative rounded-full bg-mint px-8 py-4 text-lg font-bold text-black transition-all hover:scale-105 hover:bg-glow"
        >
          Get Started Free
          <div className="absolute inset-0 -z-10 bg-mint/40 opacity-0 blur-2xl transition-opacity group-hover:opacity-100" />
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-white/10 bg-white/5 px-8 py-4 text-lg font-medium text-white backdrop-blur transition-all hover:bg-white/10"
        >
          Go to Dashboard
        </Link>
      </div>

      <section className="mt-20 grid w-full gap-8 sm:grid-cols-3">
        {[
          {
            title: "Lightning Fast",
            desc: "Settlements in seconds on the Stellar network.",
          },
          {
            title: "Zero Setup Fee",
            desc: "Register in minutes and start accepting XLM today.",
          },
          {
            title: "Developer First",
            desc: "Robust APIs and webhooks for seamless integration.",
          },
        ].map((feature, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-3xl border border-white/5 bg-white/[0.02] p-8 transition-transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-bold text-white">{feature.title}</h3>
            <p className="text-sm leading-relaxed text-slate-400">
              {feature.desc}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
