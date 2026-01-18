import { useAgUiPlanner } from './hooks/useAgUiPlanner'
import ChatPanel from './components/ChatPanel'
import Board from './components/Board'

function App() {
  const { plan } = useAgUiPlanner()

  // Determine tone class
  const toneClass = plan.global_tone === 'calm' ? 'tone-calm' 
    : plan.global_tone === 'tight' ? 'tone-tight' 
    : 'tone-neutral'

  return (
    <div className={`min-h-screen flex ${toneClass}`}>
      {/* Left Panel - Chat (30%) */}
      <div className="w-[30%] border-r border-white/30 glass-card">
        <ChatPanel />
      </div>

      {/* Right Panel - Board (70%) */}
      <div className="flex-1">
        <Board />
      </div>
    </div>
  )
}

export default App
