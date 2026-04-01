import Link from "next/link";
import { docsManifest } from "@/lib/docs-manifest";

export default function DocsIndexPage() {
  return (
    <div className="flex flex-col gap-10">
      <div className="rounded-[3rem] border border-[#E8E8E8] bg-[#F9F9F9] p-12">
        <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
          Help Center
        </p>
        <h2 className="mt-4 text-4xl font-bold text-[#0A0A0A] font-serif uppercase tracking-tight">Technical Hub</h2>
        <p className="mt-4 max-w-3xl text-sm font-medium leading-relaxed text-[#6B6B6B]">
          Comprehensive technical documentation designed for rapid integration. Learn the API flow and webhook verification in a high-precision browser experience.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {docsManifest.map((doc) => (
          <Link
            key={doc.slug}
            href={`/docs/${doc.slug}`}
            className="group relative rounded-[2.5rem] border border-[#E8E8E8] bg-white p-10 transition-all hover:border-[#0A0A0A] hover:shadow-[0_20px_60px_rgba(0,0,0,0.06)]"
          >
            <p className="font-bold text-[10px] uppercase tracking-[0.4em] text-[#6B6B6B]">
              Standard Guide
            </p>
            <h3 className="mt-4 text-2xl font-bold text-[#0A0A0A] tracking-tight">{doc.title}</h3>
            <p className="mt-4 text-sm font-medium leading-relaxed text-[#6B6B6B]">{doc.description}</p>
            <div className="mt-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[#0A0A0A] transition-transform group-hover:translate-x-1">
              Initialize Guide <span className="text-[#6B6B6B]">&rarr;</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
