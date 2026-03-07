"""LiveKit Voice Agent for Rolling 3-Day Planner.

This agent acts as a voice adapter between user speech and the existing AG-UI backend.
It handles STT/TTS and routes user queries to the planning agent via HTTP.
"""

import os
import json
import uuid
import logging
import asyncio
from typing import Optional
from pathlib import Path

import httpx
from dotenv import load_dotenv

from livekit import agents, rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    Agent,
    function_tool,
    RunContext,
)
from livekit.plugins import openai, silero, assemblyai, elevenlabs,cartesia #these plugins should be installed first before running the agent.py file

# Load .env file from the same directory as this script
# This ensures the .env file is found even when running from different directories
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger("voice-agent")
logger.setLevel(logging.INFO)

# Configuration
AGUI_BACKEND_URL = os.getenv("AGUI_BACKEND_URL", "http://localhost:8000")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "secret")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "apikey")
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
ELEVEN_API_KEY = os.getenv("ELEVEN_API_KEY")


def convert_livekit_history_to_agui_messages(session_history):
    """
    Convert LiveKit session history to AG-UI message format.
    
    Args:
        session_history: Iterable of ChatMessage items from session.history
        
    Returns:
        List of messages in AG-UI format:
        [{"id": str, "role": "user"|"assistant", "content": str}, ...]
    """
    messages = []
    
    try:
        for item in session_history:
            # Extract role - handle both string and attribute access
            role = None
            if hasattr(item, 'role'):
                role = item.role
            elif isinstance(item, dict):
                role = item.get('role')
            
            # Only include user and assistant messages
            if role not in ("user", "assistant"):
                continue
            
            # Extract content - handle both string and structured content
            content = None
            if hasattr(item, 'content'):
                content = item.content
            elif isinstance(item, dict):
                content = item.get('content')
            
            # Handle structured content (list of content blocks)
            if isinstance(content, list):
                # Extract text from content blocks
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get('type') == 'text':
                            text_parts.append(block.get('text', ''))
                        elif 'text' in block:
                            text_parts.append(str(block['text']))
                    elif isinstance(block, str):
                        text_parts.append(block)
                content = ''.join(text_parts)
            elif content is None:
                # Try to get text_content if available
                if hasattr(item, 'text_content'):
                    content = item.text_content()
                elif hasattr(item, 'text'):
                    content = item.text
                else:
                    logger.warning(f"Could not extract content from message: {item}")
                    continue
            
            # Convert content to string if not already
            if not isinstance(content, str):
                content = str(content)
            
            # Skip empty messages
            if not content.strip():
                continue
            
            # Create AG-UI formatted message
            messages.append({
                "id": str(uuid.uuid4()),
                "role": role,
                "content": content
            })
    
    except Exception as e:
        logger.error(f"Error converting LiveKit history to AG-UI format: {e}")
        # Return empty list on error - will fall back to single message
    
    return messages


class PlannerAgent(Agent):
    """Voice agent that routes queries to the AG-UI backend."""
    
    def __init__(self, thread_id: str, conversation_history: list = None):
        super().__init__(
            instructions="""You are a helpful voice assistant for managing schedules and tasks.
            When the user asks anything related to their schedule, tasks, calendar, or planning, use the query_planner tool to get information from the planning system.

            Summarize tool output intelligently to Eleven Labs v2 friendly prompt.
            Do NOT repeat every task or number.
            Group related items.
            Incase the planner is returing a clarification request, ask the user to provide more information. For example, if the planner is asking for a project name to export to todoist, ask the user to provide the project name.
            Highlight only what’s important or urgent.
            If there are many tasks, give a short overview instead of listing everything.
            Sound natural and conversational.
            No bullet points.
            No raw data or internal IDs.
            Keep it under 120 spoken words unless detail is explicitly requested.
            Do not mention tools, JSON, or internal system details.
            Return only the final voice-ready script.
            Example:
            Input (Tool Output)
            14 total tasks
            4 due today
            1 overdue (Submit vendor invoice)
            Team sync at 2:00 PM
            Deep work block at 4:30 PM
            6 low-priority backlog items

            Voice Output
            [friendly] You’ve got a moderately full day. [pause] Four things need attention today, and one invoice is slightly overdue. [reassuring] Nothing overwhelming though. You’ve got a team sync at 2, and focused work time at 4:30. [light chuckle] The rest can wait. Want me to start with the overdue item?
            """,
        )
        self._thread_id = thread_id
        self._conversation_history = conversation_history or []
    
    @function_tool()
    async def query_planner(
        self,
        context: RunContext,
        user_query: str,
    ) -> str:
        """
        Query the planning agent backend for schedule information.
        Always call this tool when the user asks about their schedule, tasks, calendar, or planning.
        Pass the user's complete question or request as the user_query parameter.
        
        Args:
            user_query: The complete user's question or request about their schedule
        
        Returns:
            The planning agent's response as text
        """
        logger.info(f"Querying planner backend: {user_query}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                # Build messages from stored history + current query
                messages = list(self._conversation_history)  # Copy existing history
                
                # Add current user query if not already in history
                if not messages or messages[-1].get("content") != user_query:
                    messages.append({
                        "id": str(uuid.uuid4()),
                        "role": "user",
                        "content": user_query
                    })
                
                # POST to backend - state will be fetched by backend if needed
                payload = {
                    "thread_id": self._thread_id,
                    "run_id": str(uuid.uuid4()),
                    "messages": messages,
                    "state": None,  # Backend will fetch current state
                    "tools": [],
                    "context": [],
                    "forwarded_props": None
                }
                
                logger.info(f"Sending {len(messages)} messages to backend with thread_id: {self._thread_id}")
                
                try:
                    async with client.stream(
                        "POST",
                        f"{AGUI_BACKEND_URL}/agent",
                        json=payload,
                        headers={"Accept": "text/event-stream"}
                    ) as response:
                        response.raise_for_status()
                        
                        # Only extract text response - state events are handled by frontend subscription
                        text_response = ""
                        async for line in response.aiter_lines():
                            if line.startswith("data: "):
                                try:
                                    data = json.loads(line[6:])
                                    
                                    # Only extract text for TTS
                                    if data.get("type") == "TEXT_MESSAGE_CONTENT":
                                        text_response += data.get("delta", "")
                                    
                                    # Stop on RUN_FINISHED
                                    elif data.get("type") == "RUN_FINISHED":
                                        break
                                    
                                except json.JSONDecodeError:
                                    continue
                        
                        # Update local history
                        if text_response:
                            messages.append({
                                "id": str(uuid.uuid4()),
                                "role": "assistant",
                                "content": text_response
                            })
                            self._conversation_history = messages
                        
                        return text_response if text_response else "I've updated your planner."
                        
                except httpx.TimeoutException:
                    logger.error("Backend request timed out")
                    return "The planner is taking too long to respond. Please try again."
                except httpx.ConnectError:
                    logger.error("Cannot connect to backend")
                    return "I can't reach the planner service right now. Please check if it's running."
                    
            except Exception as e:
                logger.error(f"Error querying backend: {e}", exc_info=True)
                return f"I encountered an error: {str(e)}"


# Create agent server
server = AgentServer()


@server.rtc_session()
async def voice_agent_session(ctx: agents.JobContext):
    """Entry point for LiveKit agent sessions."""
    
    # Get thread_id from participant metadata
    # Note: thread_id is stored in participant metadata by the token server, not room metadata
    thread_id = None
    
    logger.info(f"Checking {len(ctx.room.remote_participants)} remote participants for thread_id")
    for identity, participant in ctx.room.remote_participants.items():
        logger.info(f"Checking participant {identity}, metadata: {participant.metadata}")
        if participant.metadata:
            try:
                metadata = json.loads(participant.metadata)
                thread_id = metadata.get("thread_id")
                if thread_id:
                    logger.info(f"Found thread_id in participant {identity} metadata: {thread_id}")
                    break
            except Exception as e:
                logger.warning(f"Failed to parse participant {identity} metadata: {e}")
                continue
    
    # If still no thread_id found, generate a fallback
    # This should not happen if frontend passes thread_id correctly to token server
    if not thread_id:
        fallback_id = f"voice-{ctx.room.name}-{uuid.uuid4().hex[:8]}"
        logger.warning(f"No thread_id found in participant metadata. Using fallback: {fallback_id}")
        logger.warning(f"This means the frontend likely didn't pass thread_id to token server, or participant hasn't joined yet")
        thread_id = fallback_id
    
    logger.info(f"Voice agent session started - Room: {ctx.room.name}, Thread: {thread_id}")
    
    # Fetch existing conversation history from backend
    history = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{AGUI_BACKEND_URL}/agent/history/{thread_id}")
            if response.status_code == 200:
                data = response.json()
                history = data.get("messages", [])
                logger.info(f"Fetched {len(history)} messages from backend history")
            else:
                logger.warning(f"Failed to fetch history: HTTP {response.status_code}")
        except Exception as e:
            logger.warning(f"Failed to fetch history: {e}")
    
    # Initialize plugins
    vad = silero.VAD.load()
    stt = assemblyai.STT() #use assemblyai for stt
    tts = cartesia.TTS(model="sonic-3") #use elevenlabs for tts
    
    # Create agent with thread_id and history
    agent = PlannerAgent(thread_id=thread_id, conversation_history=history)
    
    # Create agent session
    session = AgentSession(
        vad=vad,
        stt=stt,
        llm=openai.LLM(model="gpt-4o-mini"),  # Minimal LLM for tool routing
        tts=tts,
    )
    
    # Connect to room
    await ctx.connect()
    
    # Wait a brief moment for participants to fully join and metadata to be available
    # This ensures we can read participant metadata if it wasn't available at session start
    await asyncio.sleep(0.5)
    
    # Re-check participant metadata after connection (in case it wasn't available before)
    # This is important because participant metadata might not be accessible until after connection
    final_thread_id = thread_id
    if len(ctx.room.remote_participants) > 0:
        for identity, participant in ctx.room.remote_participants.items():
            if participant.metadata:
                try:
                    metadata = json.loads(participant.metadata)
                    found_thread_id = metadata.get("thread_id")
                    if found_thread_id and not found_thread_id.startswith("voice-"):
                        logger.info(f"Found thread_id after connection in participant {identity}: {found_thread_id}")
                        final_thread_id = found_thread_id
                        break
                except Exception as e:
                    logger.warning(f"Failed to parse participant {identity} metadata after connection: {e}")
    
    # If we found a different thread_id after connection, update agent and re-fetch history
    if final_thread_id != thread_id:
        logger.info(f"Thread ID changed from {thread_id} to {final_thread_id}. Updating agent and history.")
        thread_id = final_thread_id
        agent._thread_id = thread_id
        
        # Re-fetch history with correct thread_id
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"{AGUI_BACKEND_URL}/agent/history/{thread_id}")
                if response.status_code == 200:
                    data = response.json()
                    history = data.get("messages", [])
                    agent._conversation_history = history
                    logger.info(f"Re-fetched {len(history)} messages with correct thread_id: {thread_id}")
                else:
                    logger.warning(f"Failed to re-fetch history: HTTP {response.status_code}")
            except Exception as e:
                logger.warning(f"Failed to re-fetch history: {e}")
    
    logger.info(f"Starting agent session with final thread_id: {thread_id}")
    
    # Start the session
    await session.start(room=ctx.room, agent=agent)
    
    # Build context-aware greeting
    if history:
        recent_context = history[-3:]  # Last 3 messages
        context_summary = "\n".join([f"{m['role']}: {m['content'][:100]}" for m in recent_context])
        greeting_instructions = f"""The user previously had this conversation:
    {context_summary}

    Greet them and acknowledge the previous context if relevant."""
    else:
        greeting_instructions = "Greet the user and offer to help with their schedule."

    await session.generate_reply(instructions=greeting_instructions)
    
    logger.info("Voice agent ready and listening")


if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    
    # Run the agent
    agents.cli.run_app(server)
