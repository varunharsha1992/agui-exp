# Rolling 3-Day Planner Frontend

React + Vite frontend for the Rolling 3-Day Planner, implementing the AG-UI protocol client.

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling (glassmorphism design)
- **Zustand** - State management
- **@ag-ui/client** - AG-UI protocol client
- **fast-json-patch** - JSON Patch application
- **@dnd-kit** - Drag and drop

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
VITE_AGENT_URL=http://localhost:8000/agent
```

3. Start the dev server:
```bash
npm run dev
```

4. Make sure the backend agent server is running on `http://localhost:8000`

## Project Structure

```
src/
├── components/        # React components
│   ├── Board.tsx     # Main board with columns
│   ├── ChatPanel.tsx # Left panel chat interface
│   ├── Column.tsx    # Day column (today/tomorrow/next)
│   ├── TaskCard.tsx  # Draggable task card
│   ├── StatusIndicator.tsx
│   └── ToolCallPill.tsx
├── hooks/
│   └── useAgUiPlanner.ts  # AG-UI client hook
├── store/
│   ├── types.ts          # TypeScript interfaces
│   └── usePlannerStore.ts # Zustand store
├── styles/
│   └── globals.css       # Tailwind + global styles
├── App.tsx
└── main.tsx
```

## Features

- **Split-screen layout**: Chat (30%) + Board (70%)
- **Real-time state sync**: AG-UI protocol streaming
- **Drag & drop**: Move tasks between columns
- **Optimistic updates**: Instant UI feedback
- **Glassmorphism design**: Modern, clean aesthetic
- **Visual tone theming**: Calm/Neutral/Tight backgrounds

## Development

- **Dev server**: `npm run dev`
- **Build**: `npm run build`
- **Preview**: `npm run preview`
