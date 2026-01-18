interface StatusIndicatorProps {
  status: 'idle' | 'thinking' | 'error';
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const statusConfig = {
    idle: { label: 'Idle', color: 'bg-green-500', text: 'text-green-700' },
    thinking: { label: 'Thinking', color: 'bg-blue-500', text: 'text-blue-700' },
    error: { label: 'Error', color: 'bg-red-500', text: 'text-red-700' }
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className={`w-2 h-2 rounded-full ${config.color} animate-pulse`} />
      <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
    </div>
  );
}
