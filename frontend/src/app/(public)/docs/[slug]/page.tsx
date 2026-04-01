import { notFound } from "next/navigation";
import MDXWrapper from "@/components/MDXWrapper";
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
    <article className="rounded-[3rem] border border-[#E8E8E8] bg-white p-12 shadow-[0_20px_80px_rgba(0,0,0,0.04)] sm:p-16">
      <header className="mb-12 border-b border-[#E8E8E8] pb-10">
        <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
          Reference Document
        </p>
        <h1 className="mt-4 text-5xl font-bold text-[#0A0A0A] font-serif tracking-tight uppercase">{doc.title}</h1>
        <p className="mt-6 max-w-3xl text-base font-medium leading-relaxed text-[#6B6B6B]">
          {doc.description}
        </p>
      </header>

      <div className="docs-prose">
        <MDXWrapper serialized={doc.serialized} />
      </div>
    </article>
  );
}
