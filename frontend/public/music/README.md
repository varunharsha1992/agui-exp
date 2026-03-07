# Tone music files

Add one MP3 (or OGG) per tone. The app expects these filenames:

- `calm.mp3`
- `neutral.mp3`
- `tight.mp3`
- `happy.mp3`
- `sad.mp3`
- `stressed.mp3`

If a file is missing, the player will still switch tone (theme + track metadata); playback will fail until the file exists. Paths are served from `/music/` by Vite.
