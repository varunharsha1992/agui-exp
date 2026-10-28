"""Simple script to view state snapshot for a thread."""

import os
import requests
import json
import sys

# Get thread_id from command line or use default
thread_id = sys.argv[1] if len(sys.argv) > 1 else "sample-thread"

base_url = os.getenv("AGENT_BASE_URL")
if not base_url:
    raise SystemExit("Set AGENT_BASE_URL in environment (e.g. your agent base URL) before running.")

url = f"{base_url.rstrip('/')}/agent/state/{thread_id}"

print(f"Fetching state snapshot for thread: {thread_id}")
print(f"URL: {url}\n")

try:
    response = requests.get(url, stream=True)
    
    if response.status_code != 200:
        print(f"Error: Status {response.status_code}")
        print(response.text)
        sys.exit(1)
    
    # Parse SSE stream
    for line in response.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('data: '):
                data = json.loads(line[6:])  # Remove 'data: ' prefix
                if data.get('type') == 'STATE_SNAPSHOT':
                    snapshot = data.get('snapshot', {})
                    print("State Snapshot:")
                    print(json.dumps(snapshot, indent=2))
                    break
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
