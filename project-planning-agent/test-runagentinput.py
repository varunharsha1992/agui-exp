from ag_ui.core import RunAgentInput
import json

# Test with all required fields
test_json = json.dumps({
    'threadId': 'test-thread',
    'runId': 'test-run',
    'state': None,  # or empty dict
    'messages': [{'role': 'user', 'content': 'hi', 'id': 'msg-1'}],
    'tools': [],
    'context': [],
    'forwardedProps': None
})

print("Testing RunAgentInput validation...")
print(f"JSON: {test_json}\n")

try:
    obj = RunAgentInput.model_validate_json(test_json)
    print("Success!")
    print(f"thread_id: {obj.thread_id}")
    print(f"run_id: {obj.run_id}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
