import { useAgUiPlanner } from './hooks/useAgUiPlanner'
import { useStateSubscription } from './hooks/useStateSubscription'
import ChatPanel from './components/ChatPanel'
import Board from './components/Board'
import MusicPlayer from './components/MusicPlayer'

const TONE_CLASSES: Record<string, string> = {
  calm: 'tone-calm',
  neutral: 'tone-neutral',
  tight: 'tone-tight',
  happy: 'tone-happy',
  sad: 'tone-sad',
  stressed: 'tone-stressed',
}

function App() {
  // Subscribe to state changes (works for both chat and voice)
  useStateSubscription()
  
  const { plan } = useAgUiPlanner()
  const toneClass = TONE_CLASSES[plan.global_tone] ?? 'tone-neutral'

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

      <MusicPlayer />
    </div>
  )
}

export default App
