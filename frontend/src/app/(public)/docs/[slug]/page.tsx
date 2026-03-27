import { notFound } from "next/navigation";
import { docsManifest } from "@/lib/docs-manifest";
import { getDocBySlug } from "@/lib/docs";

export async function generateStaticParams() {
  return docsManifest.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = docsManifest.find((entry) => entry.slug === slug);

  if (!doc) {
    return {
      title: "Docs",
    };
  }

  return {
    title: `${doc.title} | Docs`,
    description: doc.description,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) {
    notFound();
  }

  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur sm:p-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
          Guide
        </p>
        <h2 className="mt-3 text-3xl font-bold text-white">{doc.title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
          {doc.description}
        </p>
      </header>

      <div
        className="docs-prose"
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </article>
  );
}
