import { useRef, useCallback, useEffect, useState } from 'react';
import { useAppBridge } from '../hooks/useAppBridge';
import { usePlannerStore } from '../store/usePlannerStore';
import type { McpAppMessage } from '../store/types';

interface McpAppFrameProps {
  mcpApp: McpAppMessage;
}

export default function McpAppFrame({ mcpApp }: McpAppFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);
  const removeMcpAppMessage = usePlannerStore((s) => s.removeMcpAppMessage);

  const handleTeardown = useCallback(() => {
    removeMcpAppMessage(mcpApp.toolCallId);
  }, [mcpApp.toolCallId, removeMcpAppMessage]);

  useAppBridge({
    mcpApp,
    iframeRef,
    onTeardown: handleTeardown,
  });

  // IntersectionObserver: pause iframe when scrolled out of viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="my-2 rounded-lg overflow-hidden border border-white/20">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/10 text-xs text-gray-500">
        <span>Todoist Editor</span>
        <button
          onClick={handleTeardown}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Close"
        >
          &times;
        </button>
      </div>
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin allow-forms"
        className="w-full border-0"
        style={{
          height: '400px',
          minHeight: '200px',
          visibility: isVisible ? 'visible' : 'hidden',
        }}
        title="MCP App"
      />
    </div>
  );
}
