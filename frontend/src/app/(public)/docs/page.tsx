import Link from "next/link";
import { docsManifest } from "@/lib/docs-manifest";

export default function DocsIndexPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
          Help Center
        </p>
        <h2 className="mt-3 text-3xl font-bold text-white">Start with the guides most new users need</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
          This section renders local Markdown guides directly inside the app so merchants can learn the API flow and webhook signature verification without leaving the dashboard experience.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {docsManifest.map((doc) => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur transition-all hover:border-mint/30 hover:bg-white/10"
          >
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-mint">
              Guide
            </p>
            <h3 className="mt-3 text-xl font-semibold text-white">{doc.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">{doc.description}</p>
            <p className="mt-6 text-sm font-medium text-mint">Open guide {"->"}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
