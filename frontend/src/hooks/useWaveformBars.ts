import { useEffect, useRef, useState } from 'react';

/**
 * Reads real-time frequency amplitude from an HTMLAudioElement or MediaStreamTrack
 * using the Web Audio API AnalyserNode. Returns an array of `barCount` values
 * in the range [0, 1], updated every animation frame.
 *
 * Returns all-zeros when source is null or the AudioContext is suspended
 * (e.g. before user gesture).
 */
export function useWaveformBars(
  source: HTMLAudioElement | MediaStreamTrack | null,
  barCount = 20
): number[] {
  const [bars, setBars] = useState<number[]>(() => Array(barCount).fill(0));

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array>(new Uint8Array(0));

  useEffect(() => {
    if (!source) {
      setBars(Array(barCount).fill(0));
      return;
    }

    // Lazily create AudioContext on first real source (requires prior user gesture)
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64; // 32 frequency bins — enough for 20 bars
    analyser.smoothingTimeConstant = 0.75;
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);

    let node: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;

    if (source instanceof MediaStreamTrack) {
      const stream = new MediaStream([source]);
      node = ctx.createMediaStreamSource(stream);
    } else {
      // HTMLAudioElement — use createMediaElementSource
      // Guard against re-connecting the same element (throws InvalidStateError)
      try {
        node = ctx.createMediaElementSource(source);
      } catch {
        // Already connected — create a silent analyser that just reads silence
        analyser.disconnect();
        setBars(Array(barCount).fill(0));
        return;
      }
      // Re-connect element output so audio still plays
      node.connect(ctx.destination);
    }

    node.connect(analyser);
    sourceNodeRef.current = node;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    let running = true;

    function tick() {
      if (!running) return;
      analyser.getByteFrequencyData(dataRef.current);

      const binCount = dataRef.current.length;
      const binsPerBar = Math.max(1, Math.floor(binCount / barCount));
      const next: number[] = [];

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        for (let j = 0; j < binsPerBar; j++) {
          sum += dataRef.current[i * binsPerBar + j] ?? 0;
        }
        next.push(Math.min(1, sum / binsPerBar / 255));
      }

      setBars(next);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { node.disconnect(); } catch {}
      try { analyser.disconnect(); } catch {}
      setBars(Array(barCount).fill(0));
    };
  }, [source, barCount]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);

  return bars;
}
