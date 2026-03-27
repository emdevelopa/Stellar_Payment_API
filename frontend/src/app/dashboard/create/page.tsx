import CreatePaymentForm from "@/components/CreatePaymentForm";
import Link from "next/link";

export const metadata = {
  title: "Create Payment Link — Stellar Payment Dashboard",
  description:
    "Generate a shareable Stellar payment link for XLM or USDC in seconds.",
};

export default function CreatePaymentPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-3 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
          Dashboard
        </p>
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          Create Payment Link
        </h1>
        <p className="text-sm text-slate-400">
          Set an amount, choose an asset, and enter a Stellar recipient address
          to generate a shareable payment link.
        </p>
      </header>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <CreatePaymentForm />
      </div>

      <footer className="text-center">
        <p className="text-xs text-slate-500">
          New here?{" "}
          <Link href="/register" className="text-mint hover:underline">
            Register a merchant account
          </Link>
        </p>
      </footer>
    </main>
  );
}
