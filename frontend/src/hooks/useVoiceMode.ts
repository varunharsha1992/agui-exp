import { useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteParticipant } from 'livekit-client';
import { usePlannerStore } from '../store/usePlannerStore';
import { useThreadId } from './useThreadId';

export function useVoiceMode() {
  const store = usePlannerStore();
  const threadId = useThreadId(); // Stable thread_id shared with chat mode
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  // First agent audio element — used by VoiceOverlay for waveform visualisation
  const agentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup all audio elements
  const cleanupAudioElements = useCallback(() => {
    audioElementsRef.current.forEach((audioEl) => {
      audioEl.remove();
    });
    audioElementsRef.current.clear();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect().catch(console.error);
        cleanupAudioElements();
      }
    };
  }, [cleanupAudioElements]);

  const connect = useCallback(async () => {
    if (roomRef.current?.state === 'connected') {
      return; // Already connected
    }

    try {
      store.setVoiceStatus('connecting');

      // Generate unique identity for this session
      const identity = `user-${crypto.randomUUID().slice(0, 8)}`;
      const tokenUrl = import.meta.env.VITE_LIVEKIT_TOKEN_URL;
      const room = import.meta.env.VITE_LIVEKIT_ROOM_NAME;
      if (!tokenUrl) {
        throw new Error('Missing VITE_LIVEKIT_TOKEN_URL. Set it in your frontend .env.');
      }
      if (!room) {
        throw new Error('Missing VITE_LIVEKIT_ROOM_NAME. Set it in your frontend .env.');
      }

      // Fetch token from token server with thread_id
      const tokenResponse = await fetch(
        `${tokenUrl}?identity=${identity}&room=${room}&thread_id=${threadId}`
      );

      if (!tokenResponse.ok) {
        throw new Error(`Token fetch failed: ${tokenResponse.statusText}`);
      }

      const { token, url } = await tokenResponse.json();

      // Create and connect to room
      const livekitRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // Set up event handlers
      livekitRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'audio' && participant instanceof RemoteParticipant) {
          // Only handle agent audio (remote participants)
          handleAudioTrack(track, participant.identity);
        }
      });

      livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        // Clean up audio element when track is unsubscribed
        const audioEl = audioElementsRef.current.get(track.sid);
        if (audioEl) {
          audioEl.remove();
          audioElementsRef.current.delete(track.sid);
        }
      });

      livekitRoom.on(RoomEvent.Disconnected, () => {
        store.setVoiceMode(false);
        store.setVoiceStatus('idle');
        cleanupAudioElements();
      });

      livekitRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === 'connected') {
          store.setVoiceStatus('connected');
          store.setVoiceMode(true);
        } else if (state === 'disconnected') {
          store.setVoiceStatus('idle');
          store.setVoiceMode(false);
        }
      });

      // Connect to room
      await livekitRoom.connect(url, token);

      // Enable microphone with raw audio constraints so Silero VAD on the
      // agent side gets full-fidelity audio. Browser echo cancellation /
      // noise suppression can suppress speech below the VAD threshold.
      await livekitRoom.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,  // keep AGC so quiet speakers still register
      });

      roomRef.current = livekitRoom;
    } catch (error) {
      console.error('Failed to connect to voice room:', error);
      store.setVoiceStatus('error');
      store.setVoiceMode(false);
      throw error;
    }
  }, [store, threadId]);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      try {
        // Disable microphone
        await roomRef.current.localParticipant.setMicrophoneEnabled(false);
        
        // Disconnect from room
        await roomRef.current.disconnect();
      } catch (error) {
        console.error('Error disconnecting from room:', error);
      } finally {
        roomRef.current = null;
        agentAudioRef.current = null;
        cleanupAudioElements();
        store.setVoiceMode(false);
        store.setVoiceStatus('idle');
      }
    }
  }, [store]);

  const toggleVoiceMode = useCallback(async () => {
    if (store.voiceMode) {
      await disconnect();
    } else {
      await connect();
    }
  }, [store.voiceMode, connect, disconnect]);

  // Handle audio track subscription
  const handleAudioTrack = useCallback((track: Track, participantIdentity: string) => {
    // Only handle agent audio (not our own)
    if (participantIdentity.startsWith('user-')) {
      return;
    }

    // Create audio element for this track
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    // Attach track to audio element
    track.attach(audioEl);

    // Store reference for cleanup
    audioElementsRef.current.set(track.sid, audioEl);

    // Keep a ref to the first agent audio element for waveform visualisation
    if (!agentAudioRef.current) {
      agentAudioRef.current = audioEl;
    }
  }, []);

  return {
    voiceMode: store.voiceMode,
    voiceStatus: store.voiceStatus,
    connect,
    disconnect,
    toggleVoiceMode,
    roomRef,
    agentAudioRef,
  };
}
