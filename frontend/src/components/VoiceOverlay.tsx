import { useRef, useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import { usePlannerStore } from '../store/usePlannerStore';
import { useWaveformBars } from '../hooks/useWaveformBars';

const BAR_COUNT = 16;

interface WaveformProps {
  bars: number[];
  color: string;
  label: string;
}

function Waveform({ bars, color, label }: WaveformProps) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-end gap-[2px] h-6">
        {bars.map((v, i) => (
          <div
            key={i}
            className="w-1 rounded-full transition-all duration-75"
            style={{
              height: `${Math.max(3, v * 24)}px`,
              backgroundColor: color,
              opacity: 0.3 + v * 0.7,
            }}
          />
        ))}
      </div>
      <span className="text-[9px] uppercase tracking-widest opacity-40">{label}</span>
    </div>
  );
}

interface VoiceOverlayProps {
  roomRef: React.RefObject<Room | null>;
}

export default function VoiceOverlay({ roomRef }: VoiceOverlayProps) {
  const ephemeralAssistant = usePlannerStore((s) => s.ephemeralAssistant);
  const activeToolCalls = usePlannerStore((s) => s.activeToolCalls);
  const status = usePlannerStore((s) => s.status);

  // Mic track — local participant's microphone
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  // Agent track — remote participant's audio (TTS output)
  const [agentTrack, setAgentTrack] = useState<MediaStreamTrack | null>(null);

  const micPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Poll for mic track
    micPollRef.current = setInterval(() => {
      const room = roomRef.current;
      if (!room) return;
      const pub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
      const track = pub?.track?.mediaStreamTrack ?? null;
      if (track) {
        setMicTrack(track);
        if (micPollRef.current) clearInterval(micPollRef.current);
      }
    }, 200);

    // Poll for agent audio track from any remote participant
    agentPollRef.current = setInterval(() => {
      const room = roomRef.current;
      if (!room) { setAgentTrack(null); return; }
      let found: MediaStreamTrack | null = null;
      for (const [, participant] of room.remoteParticipants) {
        for (const pub of participant.trackPublications.values()) {
          if (pub.kind === 'audio' && pub.track?.mediaStreamTrack) {
            found = pub.track.mediaStreamTrack;
            break;
          }
        }
        if (found) break;
      }
      setAgentTrack((prev) => (found !== prev ? found : prev));
    }, 100);

    return () => {
      if (micPollRef.current) clearInterval(micPollRef.current);
      if (agentPollRef.current) clearInterval(agentPollRef.current);
      setMicTrack(null);
      setAgentTrack(null);
    };
  }, [roomRef]);

  const micBars = useWaveformBars(micTrack, BAR_COUNT);
  const agentBars = useWaveformBars(agentTrack, BAR_COUNT);

  const progressText =
    ephemeralAssistant?.content ||
    (activeToolCalls.length > 0
      ? activeToolCalls[activeToolCalls.length - 1].name.replace(/_/g, ' ')
      : null);

  const statusLabel =
    status === 'thinking'
      ? progressText || 'Thinking…'
      : 'Listening…';

  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <Waveform bars={micBars} color="#6b7280" label="You" />

      <div className="flex-1 min-w-0 text-center">
        <p className="text-xs text-gray-500 truncate italic">{statusLabel}</p>
      </div>

      <Waveform bars={agentBars} color="#3b82f6" label="Agent" />
    </div>
  );
}
