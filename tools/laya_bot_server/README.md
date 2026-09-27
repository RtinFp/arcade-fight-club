# Laya bot sidecar (experimental)

Local action server for Arcade Fight Club AI-Bot. Same idea as the public
Tetris / Chrome Dino demos: pack state as text → Laya picks one action →
the browser holds that action until the next decision (~450 ms).

## Setup

```bash
cd tools/laya_bot_server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python server.py
```

`http://127.0.0.1:8765` — `POST /decide` with `{"state":"..."}` → `{"action":"jab"|...}`.

**Restart the sidecar** after pulling changes (action schema replaced styles).

## Actions

`approach` `retreat` `jab` `special` `block` `jump` `wait`

State text tells Laya when the player is **blocking** so it should not jab into shield.
The browser also sanitizes: jab/special/approach into a block becomes wait/retreat.

## Demo

1. Start sidecar, start Flask, open AI-Bot.
2. HUD shows `BOT: WAIT` / `JAB` / `RETREAT` (green = Laya, yellow = local fallback).
3. Hold block in the bot’s face — it should stop the punch-loop and wait/retreat.

Classic checklist: `?classicBot=1`
