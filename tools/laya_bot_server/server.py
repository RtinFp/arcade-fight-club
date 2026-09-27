"""
Local Laya sidecar — action decisions for Arcade Fight Club AI-Bot.

Browser sends a short fight-state string; Laya returns one combat action.
Same pattern as the Tetris / Chrome Dino demos: state → typed choice → apply.
"""

from __future__ import annotations

import os
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

ACTIONS = ("approach", "retreat", "jab", "special", "block", "jump", "wait")

ACTION_CRITERIA = {
    "approach": "Walk toward the player. Use when far and it is safe to close (player not blocking right in your face).",
    "retreat": "Walk away / create space. Use when too close, player is blocking and you should reset, or you are low HP.",
    "jab": "Throw a light melee attack. Use when in range AND the player is NOT blocking. Do not jab into a block.",
    "special": "Use heavy/special when meter is ready, in range, and the player is open (not blocking). Do not dump into a block.",
    "block": "Guard now. Use when the player is attacking nearby.",
    "jump": "Jump. Use to dodge a heavy/combo or to create space — not every second.",
    "wait": "Stand still / hold. Use when player is blocking in your face (do not walk into the shield), or when waiting for an opening.",
}

QUESTIONS = {
    "action": {
        "type": "choice",
        "instructions": (
            "You control an arcade fighter for ONE next action. "
            "Be smart: never jab or special into a blocking opponent; prefer wait or retreat then. "
            "If the player is attacking nearby, block. If far, approach. "
            "Do not repeat a pointless approach-jab-retreat loop."
        ),
        "criteria": ACTION_CRITERIA,
    }
}

_router = None


def get_router():
    global _router
    if _router is None:
        from laya import Router

        _router = Router()
    return _router


@app.get("/health")
def health():
    return jsonify({"ok": True, "actions": list(ACTIONS)})


@app.post("/decide")
def decide():
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    state = (payload.get("state") or "").strip()
    if not state:
        return jsonify({"error": "missing state"}), 400

    try:
        router = get_router()
        result = router.predict(state, QUESTIONS, model="english")
        choice = result.get("answers", {}).get("action", {}).get("choice")
        if choice not in ACTIONS:
            choice = "wait"
        return jsonify(
            {
                "action": choice,
                "routing": result.get("routing"),
                "answers": result.get("answers"),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc), "action": "wait"}), 500


def main():
    host = os.environ.get("LAYA_HOST", "127.0.0.1")
    port = int(os.environ.get("LAYA_PORT", "8765"))
    print(f"Laya bot sidecar listening on http://{host}:{port}")
    print("POST /decide  GET /health  actions=", ",".join(ACTIONS))
    app.run(host=host, port=port, threaded=True)


if __name__ == "__main__":
    main()
