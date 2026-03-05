import { useState, useRef, useEffect } from 'react';
import { useAgUiPlanner } from '../hooks/useAgUiPlanner';
import { useVoiceMode } from '../hooks/useVoiceMode';
import StatusIndicator from './StatusIndicator';
import ToolCallPill from './ToolCallPill';

export default function ChatPanel() {
  const { messages, status, error, activeToolCalls, sendMessage } = useAgUiPlanner();
  const { voiceMode, voiceStatus, toggleVoiceMode } = useVoiceMode();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status !== 'thinking') {
      sendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-white/30">
        <div className="flex items-center justify-between gap-2">
          <StatusIndicator status={status} />
          <button
            onClick={toggleVoiceMode}
            disabled={voiceStatus === 'connecting'}
            className={`
              relative px-3 py-2 rounded-lg transition-all
              ${voiceMode 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : voiceStatus === 'connecting'
                ? 'bg-gray-500 text-white cursor-wait'
                : 'bg-gray-600 hover:bg-gray-700 text-white'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
              ${voiceMode ? 'animate-pulse' : ''}
            `}
            title={voiceMode ? 'Stop voice mode' : 'Start voice mode'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            {voiceStatus === 'connecting' && (
              <span className="absolute inset-0 flex items-center justify-center">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
            )}
          </button>
        </div>
        {voiceMode && voiceStatus === 'connected' && (
          <div className="mt-2 text-xs text-green-400 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Listening...
          </div>
        )}
        {error && (
          <div className="mt-2 p-2 bg-red-100/50 border border-red-200/50 rounded text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-sm">Start a conversation with your planner</p>
            <p className="text-xs mt-2">Try: "Show me my schedule"</p>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/50 backdrop-blur-sm text-gray-800'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            </div>
          </div>
        ))}

        {/* Active Tool Calls */}
        {activeToolCalls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeToolCalls.map((toolCall) => (
              <ToolCallPill key={toolCall.id} name={toolCall.name} />
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/30">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={voiceMode ? "Listening... (voice mode active)" : "Talk to your planner..."}
            disabled={status === 'thinking' || voiceMode}
            className="flex-1 px-4 py-2 bg-white/50 backdrop-blur-sm border border-white/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || status === 'thinking' || voiceMode}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
