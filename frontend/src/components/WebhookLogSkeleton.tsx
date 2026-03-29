export default function WebhookLogSkeleton() {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/5">
            <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
              Status
            </th>
            <th className="px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400">
              Event
            </th>
            <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 sm:table-cell">
              Endpoint
            </th>
            <th className="hidden px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-400 md:table-cell">
              Time
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {[...Array(5)].map((_, i) => (
            <tr key={i} className="animate-pulse">
              <td className="px-4 py-3">
                <div className="h-5 w-10 rounded-full bg-white/10"></div>
              </td>
              <td className="px-4 py-3">
                <div className="h-5 w-32 rounded bg-white/10"></div>
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <div className="h-5 w-48 rounded bg-white/10"></div>
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <div className="h-5 w-36 rounded bg-white/10"></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
