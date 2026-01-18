import requests
import uuid
import json

url = "http://localhost:8000/agent"

thread_id = 'sample-thread'
run_id = 'sample-run'

payload = {
    "threadId": thread_id,
    "runId": run_id,
    "state": None,
    "messages": [
        {
            "role": "user",
            "content": "I feel very overwhelmed. Can you balance my day?",
            "id": str(uuid.uuid4())
        }
    ],
    "tools": [],
    "context": [],
    "forwardedProps": None
}

print("Sending request to:", url)
print("Payload:", json.dumps(payload, indent=2))

response = requests.post(url, json=payload, stream=True)

print(f"\nResponse Status: {response.status_code}")
print(f"Response Headers: {dict(response.headers)}")

if response.status_code != 200:
    print(f"\nError Response:")
    print(response.text)
    exit(1)

print("\n--- Streaming Events ---\n")

# Parse SSE manually
for line in response.iter_lines():
    if line:
        line = line.decode('utf-8')
        if line.startswith('data: '):
            try:
                data = json.loads(line[6:])  # Remove 'data: ' prefix
                event_type = data.get('type', 'UNKNOWN')
                print(f"Event type: {event_type}")
                
                if event_type == 'TEXT_MESSAGE_CONTENT':
                    print(f"  Message: {data.get('delta', '')}")
                elif event_type == 'STATE_DELTA':
                    print(f"  State change: {json.dumps(data.get('delta'), indent=4)}")
                elif event_type == 'STATE_SNAPSHOT':
                    print(f"  State snapshot received")
                elif event_type == 'TOOL_CALL_START':
                    print(f"  Tool call: {data.get('toolCallName', '')}")
                elif event_type == 'TOOL_CALL_END':
                    print(f"  Tool call ended")
                elif event_type == 'RUN_STARTED':
                    print(f"  Run started: {data.get('runId', '')}")
                elif event_type == 'RUN_FINISHED':
                    print(f"  Run finished: {data.get('runId', '')}")
                    break
            except json.JSONDecodeError as e:
                print(f"  Failed to parse event data: {e}")
                print(f"  Raw line: {line}")
