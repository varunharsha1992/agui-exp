interface ToolCallPillProps {
  name: string;
}

export default function ToolCallPill({ name }: ToolCallPillProps) {
  // Format tool names for display
  const displayName = name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100/50 border border-blue-200/50 rounded-full text-xs text-blue-700">
      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
      <span>{displayName}...</span>
    </div>
  );
}
