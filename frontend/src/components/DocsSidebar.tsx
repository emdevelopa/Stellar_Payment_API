"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsManifest } from "@/lib/docs-manifest";

export default function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-3">
      <Link
        href="/docs"
        className={`rounded-xl border px-4 py-3 text-sm transition-all ${
          pathname === "/docs"
            ? "border-mint/40 bg-mint/10 text-mint"
            : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
        }`}
      >
        Docs Home
      </Link>

      {docsManifest.map((doc) => {
        const href = `/docs/${doc.slug}`;
        const active = pathname === href;

        return (
          <Link
            key={doc.slug}
            href={href}
            className={`rounded-xl border px-4 py-3 transition-all ${
              active
                ? "border-mint/40 bg-mint/10 text-white"
                : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
            }`}
          >
            <p className="text-sm font-semibold">{doc.title}</p>
            <p className="mt-1 text-xs text-slate-400">{doc.description}</p>
          </Link>
        );
      })}
    </nav>
  );
}
