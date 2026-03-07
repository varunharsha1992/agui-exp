import { useEffect, useRef, useState } from 'react';
import { usePlannerStore } from '../store/usePlannerStore';
import { TONE_TRACKS } from '../config/toneMusic';

const FADE_MS = 300;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicPlayer() {
  const globalTone = usePlannerStore((s) => s.plan.global_tone);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const wasPlayingRef = useRef(false);

  const track = TONE_TRACKS[globalTone];

  // When tone changes: fade out, swap src, fade in, resume if was playing
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;

    const fadeOut = (): Promise<void> =>
      new Promise((resolve) => {
        const start = el.volume;
        const startTime = performance.now();
        const tick = () => {
          const t = (performance.now() - startTime) / FADE_MS;
          if (t >= 1) {
            el.volume = 0;
            resolve();
            return;
          }
          el.volume = start * (1 - t);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    const fadeIn = (): Promise<void> =>
      new Promise((resolve) => {
        const startTime = performance.now();
        const tick = () => {
          const t = (performance.now() - startTime) / FADE_MS;
          if (t >= 1) {
            el.volume = 1;
            resolve();
            return;
          }
          el.volume = t;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    let cancelled = false;
    (async () => {
      wasPlayingRef.current = !el.paused;
      await fadeOut();
      if (cancelled) return;
      el.src = track.file;
      el.load();
      await new Promise((r) => {
        el.addEventListener('loadedmetadata', r, { once: true });
      });
      if (cancelled) return;
      await fadeIn();
      if (cancelled) return;
      if (wasPlayingRef.current) el.play().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [globalTone, track?.file]);

  // No track for current tone (shouldn't happen with all 6 in TONE_TRACKS)
  if (!track) return null;

  if (!isVisible) {
    return (
      <button
        type="button"
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 z-50 px-3 py-1.5 rounded-full glass-card text-sm text-gray-700 hover:bg-white/40 shadow"
      >
        ♪ Show player
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[288px] rounded-xl glass-card shadow-xl overflow-hidden">
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <div className="p-3 flex gap-3">
        {/* Album art placeholder */}
        <div
          className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center text-2xl"
          style={{ backgroundColor: 'color-mix(in srgb, var(--tone-accent) 25%, transparent)' }}
        >
          ♪
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-800 truncate">{track.title}</p>
          <p className="text-xs text-gray-600 truncate">{track.artist}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsVisible(false)}
          className="text-gray-500 hover:text-gray-700 text-sm shrink-0"
          aria-label="Collapse player"
        >
          −
        </button>
      </div>
      {/* Progress bar */}
      <div className="px-3 pb-1">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            step={0.1}
            className="flex-1 h-1.5 rounded-full appearance-none bg-white/40 accent-gray-600"
            onChange={(e) => {
              const t = Number(e.target.value);
              setCurrentTime(t);
              if (audioRef.current) audioRef.current.currentTime = t;
            }}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      {/* Controls */}
      <div className="px-3 pb-3 flex items-center justify-center gap-1">
        <button
          type="button"
          className="p-2 rounded-full hover:bg-white/30 text-gray-700"
          aria-label="Previous"
          onClick={() => {}}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button
          type="button"
          className="p-2 rounded-full hover:bg-white/30 text-gray-700"
          aria-label="Play / Pause"
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            if (el.paused) el.play().catch(() => {});
            else el.pause();
          }}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="p-2 rounded-full hover:bg-white/30 text-gray-700"
          aria-label="Next"
          onClick={() => {}}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
