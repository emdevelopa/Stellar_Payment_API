"use client";

interface AuditLog {
  id: string;
  action: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
}

interface Props {
  logs: AuditLog[];
}

export default function Timeline({ logs }: Props) {
  if (!logs || logs.length === 0) {
    return (
      <div className="text-gray-400 text-center py-10">
        No activity yet
      </div>
    );
  }

  return (
    <div className="relative border-l border-gray-700 pl-6 space-y-6">
      {logs.map((log) => (
        <div key={log.id} className="relative">
          {/* Dot */}
          <div className="absolute -left-3 top-1 w-3 h-3 bg-blue-500 rounded-full"></div>

          {/* Content */}
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-white font-medium">{log.action}</p>

            {log.field_changed && (
              <p className="text-gray-400 text-sm mt-1">
                {log.field_changed}: {log.old_value} → {log.new_value}
              </p>
            )}

            <p className="text-gray-500 text-xs mt-2">
              {new Date(log.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}