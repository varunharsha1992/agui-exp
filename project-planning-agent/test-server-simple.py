import requests
import uuid
import json

import os

base_url = os.getenv("AGENT_BASE_URL")
if not base_url:
    raise SystemExit("Set AGENT_BASE_URL in environment before running this script.")

url = f"{base_url.rstrip('/')}/agent"

payload = {
    "threadId": str(uuid.uuid4()),
    "runId": str(uuid.uuid4()),
    "messages": [
        {"role": "user", "content": "Show me my schedule"}
    ]
}

print("Sending request...")
print(f"Payload: {json.dumps(payload, indent=2)}")

try:
    response = requests.post(url, json=payload, stream=True)
    print(f"\nStatus Code: {response.status_code}")
    print(f"Headers: {dict(response.headers)}")
    
    if response.status_code != 200:
        print(f"\nError Response:")
        print(response.text)
    else:
        print("\nResponse (first 1000 chars):")
        content = response.text[:1000]
        print(content)
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
