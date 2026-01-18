# Rolling 3-Day Planner Agent

AG-UI Protocol compliant agent server using LangChain v1.

## Prerequisites

- Python 3.9 or higher
- OpenAI API key (or other supported provider)

## Setup

1. **Install dependencies:**
   ```bash
   cd agent
   pip install -r requirements.txt
   ```

2. **Configure environment:**
   ```bash
   # Copy the example env file
   cp .env.example .env
   
   # Edit .env and add your OpenAI API key
   # OPENAI_API_KEY=sk-your-key-here
   ```

## Running the Server

### Option 1: Direct Python
```bash
cd agent
python server.py
```

### Option 2: Uvicorn (recommended for production)
```bash
cd agent
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

### Option 3: Environment-specific settings
```bash
cd agent
# Set custom port
export SERVER_PORT=8080
python server.py
```

## Server Endpoints

- **POST `/agent`** - Main AG-UI endpoint (accepts `RunAgentInput`, streams AG-UI events)
- **GET `/agent/state/{thread_id}`** - Get state snapshot for a thread
- **GET `/health`** - Health check endpoint

## Testing

Once running, test the health endpoint:
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{"status": "healthy", "protocol": "ag-ui"}
```

## Environment Variables

See `.env.example` for all available configuration options:
- `OPENAI_API_KEY` - Your OpenAI API key (required)
- `AGENT_MODEL` - Model to use (default: `gpt-4o`)
- `SERVER_HOST` - Server host (default: `0.0.0.0`)
- `SERVER_PORT` - Server port (default: `8000`)
- `CORS_ORIGINS` - CORS origins (default: `*`)

## Next Steps

Connect your frontend using the `@ag-ui/client` SDK to `http://localhost:8000/agent`.
