import { notFound } from "next/navigation";
import MDXWrapper from "@/components/MDXWrapper";
import { docsManifest } from "@/lib/docs-manifest";
import { getDocBySlug } from "@/lib/docs";
import Link from "next/link";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = docsManifest.find((e) => e.slug === slug);
  if (!doc) return { title: "Docs" };
  return { title: `${doc.title} | PLUTO Docs`, description: doc.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) notFound();

  const isX402 = slug === "x402-agentic-payments";

  return (
    <article className="flex flex-col gap-0 rounded-2xl border border-[#E8E8E8] bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <header className="border-b border-[#E8E8E8] bg-[#F9F9F9] px-8 py-8 sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Link href="/docs" className="text-[10px] font-bold uppercase tracking-widest text-[#6B6B6B] hover:text-[var(--pluto-500)] transition-colors">
                ← Docs
              </Link>
              {isX402 && (
                <span className="rounded-full bg-[var(--pluto-100)] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[var(--pluto-600)]">
                  New · x402
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold text-[#0A0A0A] tracking-tight">{doc.title}</h1>
            <p className="max-w-2xl text-sm font-medium leading-relaxed text-[#6B6B6B]">{doc.description}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="px-8 py-10 sm:px-10 docs-prose">
        <MDXWrapper serialized={doc.serialized} />
      </div>
    </article>
  );
}
