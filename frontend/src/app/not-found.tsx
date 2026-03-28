import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center relative overflow-hidden">
      {/* Animated background stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-mint rounded-full animate-pulse" />
        <div
          className="absolute top-1/3 right-1/3 w-1 h-1 bg-glow rounded-full animate-pulse"
          style={{ animationDelay: "0.5s" }}
        />
        <div
          className="absolute bottom-1/4 left-1/3 w-1 h-1 bg-mint rounded-full animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <div
          className="absolute top-2/3 right-1/4 w-1 h-1 bg-glow rounded-full animate-pulse"
          style={{ animationDelay: "1.5s" }}
        />
      </div>

      <div className="flex flex-col items-center gap-8 max-w-md relative z-10">
        {/* 404 Illustration - Lost in Space */}
        <div className="relative w-64 h-64">
          <svg
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full"
          >
            {/* Orbital rings */}
            <circle
              cx="100"
              cy="100"
              r="70"
              stroke="currentColor"
              strokeWidth="1"
              className="text-mint/20"
              strokeDasharray="4 4"
            />
            <circle
              cx="100"
              cy="100"
              r="50"
              stroke="currentColor"
              strokeWidth="1"
              className="text-mint/30"
              strokeDasharray="4 4"
            />

            {/* Central planet/star */}
            <circle
              cx="100"
              cy="100"
              r="30"
              fill="currentColor"
              className="text-mint/20"
            />
            <circle
              cx="100"
              cy="100"
              r="20"
              fill="currentColor"
              className="text-mint"
            />

            {/* Star points */}
            <g
              className="text-mint animate-pulse"
              style={{ animationDuration: "3s" }}
            >
              <path
                d="M100 60L100 80M100 120L100 140M60 100L80 100M120 100L140 100"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M73 73L85 85M115 115L127 127M73 127L85 115M115 85L127 73"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>

            {/* Floating satellite/probe */}
            <g
              className="animate-pulse"
              style={{ animationDuration: "2s", animationDelay: "0.5s" }}
            >
              <circle
                cx="150"
                cy="70"
                r="8"
                fill="currentColor"
                className="text-slate-400"
              />
              <path
                d="M142 70L134 70M158 70L166 70"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-slate-400"
              />
            </g>
          </svg>

          {/* Glow effect */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-mint/10 blur-3xl rounded-full" />
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-mint">
            Error 404
          </p>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Lost in the Stellar Network
          </h1>
          <p className="text-slate-400">
            The page you&apos;re looking for has drifted into deep space.
            Let&apos;s navigate you back to familiar territory.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/dashboard"
            className="group relative flex items-center justify-center gap-2 rounded-full border border-mint/30 bg-mint/5 px-8 py-3 text-sm font-semibold text-mint backdrop-blur transition-all hover:bg-mint/10"
          >
            Return to Dashboard
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
            <div className="absolute inset-0 -z-10 bg-mint/10 opacity-0 blur-xl transition-opacity group-hover:opacity-100" />
          </Link>

          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-8 py-3 text-sm font-semibold text-white backdrop-blur transition-all hover:bg-white/10"
          >
            Go Home
          </Link>
        </div>
      </div>
    </main>
  );
}
