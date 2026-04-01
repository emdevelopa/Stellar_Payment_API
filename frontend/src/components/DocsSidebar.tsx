"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsManifest } from "@/lib/docs-manifest";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4">
      <Link
        href="/docs"
        className={`rounded-2xl border px-6 py-4 text-[10px] font-bold uppercase tracking-widest transition-all ${
          pathname === "/docs"
            ? "border-[#0A0A0A] bg-[#0A0A0A] text-white"
            : "border-[#E8E8E8] bg-white text-[#6B6B6B] hover:border-[#0A0A0A] hover:bg-[#F9F9F9] hover:text-[#0A0A0A]"
        }`}
      >
        Library Home
      </Link>

      {docsManifest.map((doc) => {
        const href = `/docs/${doc.slug}`;
        const active = pathname === href;

        return (
          <Link
            key={doc.slug}
            href={href}
            className={`rounded-2xl border px-6 py-4 transition-all ${
              active
                ? "border-[#0A0A0A] bg-[#0A0A0A] text-white shadow-xl shadow-black/5"
                : "border-[#E8E8E8] bg-white text-[#6B6B6B] hover:border-[#0A0A0A] hover:bg-[#F9F9F9]"
            }`}
          >
            <p className={`text-sm font-bold tracking-tight ${active ? "text-white" : "text-[#0A0A0A]"}`}>{doc.title}</p>
            <p className={`mt-1 text-[10px] font-medium uppercase tracking-widest ${active ? "text-white/60" : "text-[#6B6B6B]"}`}>{doc.slug.replace(/-/g, ' ')}</p>
          </Link>
        );
      })}
    </nav>
  );
}
