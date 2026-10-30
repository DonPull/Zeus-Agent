"""Injected into action processes; transport/policy belongs to the Rust owner."""
import uuid as _uuid
import threading as _threading
_lock = _threading.Lock()


def call(op, *, action_id=None, **params):
    with _lock:
        response = _send({"type": "managed_browser", "command": {"op": op, "params": params, "action_id": action_id or str(_uuid.uuid4())}})
    if not isinstance(response, dict):
        raise RuntimeError("BROWSER_TRANSPORT: browser owner did not reply")
    if not response.get("ok"):
        error = response.get("error", {})
        raise RuntimeError(f"{error.get('code', 'BROWSER_ERROR')}: {error.get('message', 'Browser operation failed')}")
    result = dict(response.get("result", {}))
    result["session_id"] = response.get("session_id")
    result["generation"] = response.get("generation")
    return result
