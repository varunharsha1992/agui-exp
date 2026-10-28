"""FastAPI server for generating LiveKit access tokens.

This service provides a token endpoint for the frontend to connect to LiveKit rooms.
"""

import os
import json
from typing import Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from livekit import api

env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

app = FastAPI(title="LiveKit Token Server")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment variables
def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


LIVEKIT_URL = require_env("LIVEKIT_URL")
LIVEKIT_API_KEY = require_env("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = require_env("LIVEKIT_API_SECRET")
TOKEN_SERVER_PORT = int(os.getenv("TOKEN_SERVER_PORT", "8001"))


@app.get("/livekit/token")
async def get_livekit_token(
    identity: str,
    room: Optional[str] = None,
    thread_id: Optional[str] = None
):
    """
    Generate a LiveKit access token for the frontend.
    
    Args:
        identity: User identifier
        room: Room name to join (recommended: pass ?room=... from the frontend)
        thread_id: Optional thread ID for state continuity
    
    Returns:
        JSON with token and server URL
    """
    try:
        effective_room = room or os.getenv("LIVEKIT_ROOM_NAME")
        if not effective_room:
            raise HTTPException(
                status_code=400,
                detail="Missing LiveKit room name. Provide ?room=... or set LIVEKIT_ROOM_NAME in environment.",
            )

        # Build token with chainable methods
        token_builder = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
            .with_identity(identity) \
            .with_name(f"User {identity}") \
            .with_grants(api.VideoGrants(
                room_join=True,
                room=effective_room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            ))
        
        # Store thread_id in participant metadata if provided
        if thread_id:
            token_builder = token_builder.with_metadata(json.dumps({"thread_id": thread_id}))
        
        # Generate JWT token
        jwt_token = token_builder.to_jwt()
        
        return {
            "token": jwt_token,
            "url": LIVEKIT_URL,
            "room": effective_room,
            "thread_id": thread_id
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate token: {str(e)}"
        )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "livekit-token-server",
        "livekit_url": LIVEKIT_URL
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=TOKEN_SERVER_PORT
    )
