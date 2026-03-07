/** Paths are relative to public/ — Vite serves them as-is. */

export interface ToneTrack {
  file: string;
  title: string;
  artist: string;
}

export const TONE_TRACKS: Record<string, ToneTrack> = {
  calm: { file: '/music/calm.mp3', title: 'Calm Waters', artist: 'Tone: Calm' },
  neutral: { file: '/music/neutral.mp3', title: 'Steady Drift', artist: 'Tone: Neutral' },
  tight: { file: '/music/tight.mp3', title: 'Under Pressure', artist: 'Tone: Tight' },
  happy: { file: '/music/happy.mp3', title: 'Bright Days', artist: 'Tone: Happy' },
  sad: { file: '/music/sad.mp3', title: 'Grey Skies', artist: 'Tone: Sad' },
  stressed: { file: '/music/stressed.mp3', title: 'Relaxing Waves', artist: 'Tone: Relaxed' },
};
