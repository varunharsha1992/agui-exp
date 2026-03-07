## Time Scheduling Rules

These rules apply whenever the agent assigns time slots to tasks.

- Working hours: 09:00–19:00 only. Never schedule outside this window.
- Fixed tasks: preserve their `start_time` from calendar data exactly. Never mutate.
- Flexible tasks: pack from 09:00, leave a 15-minute buffer after each fixed task ends.
- All `duration_minutes` values must be multiples of 30 (minimum 30). Round up if needed.
- Never schedule overlapping tasks on the same day.
- If a day is full (no free 30-min slot between 09:00–19:00), move the flexible task to the next available day.
- Tone thresholds based on total scheduled minutes per day:
  - < 240 minutes (4h): calm
  - 240–480 minutes (4–8h): neutral
  - > 480 minutes (8h+): tight
- When calling set_full_plan, always include `start_time` and `duration_minutes` for every task.
