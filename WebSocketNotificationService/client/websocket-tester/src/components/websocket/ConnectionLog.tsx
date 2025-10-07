'use client';

interface ConnectionLogProps {
  logs: string[];
  onClear: () => void;
}

export default function ConnectionLog({ logs, onClear }: ConnectionLogProps) {
  return (
    <div className="w-80 bg-gray-900 text-gray-100 overflow-y-auto p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-gray-200">Connection Log</h2>
        <button
          onClick={onClear}
          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="space-y-1 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-gray-500">No log entries yet...</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="text-gray-300 break-words">
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
