import eventlet

eventlet.monkey_patch()

import os
import re
import sqlite3
import json
import time
from functools import wraps
from flask import Flask, redirect, render_template, request, g, session, jsonify
import uuid
from flask_socketio import SocketIO, join_room, emit
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-change-me")
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_timeout=30,
    ping_interval=15,
    max_http_buffer_size=10e6,
)

DATABASE = "fightClub.db"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
# Prevent double-counting when both clients (or OK backup) post the same bout.
_recent_scores = {}
_SCORE_DEDUP_SEC = 45


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,
            host_sid TEXT,
            joiner_sid TEXT,
            host_username TEXT,
            joiner_username TEXT
        )
        """
    )
    cols = {row[1] for row in db.execute("PRAGMA table_info(rooms)").fetchall()}
    if "host_username" not in cols:
        db.execute("ALTER TABLE rooms ADD COLUMN host_username TEXT")
    if "joiner_username" not in cols:
        db.execute("ALTER TABLE rooms ADD COLUMN joiner_username TEXT")

    # Legacy DBs used id PK; newer code used username PK. CREATE IF NOT EXISTS
    # won't reshape an existing table, so we only seed + patch columns/nulls.
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT DEFAULT '',
            win INTEGER NOT NULL DEFAULT 0,
            lose INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    player_cols = {row[1] for row in db.execute("PRAGMA table_info(players)").fetchall()}
    if "password" not in player_cols:
        db.execute("ALTER TABLE players ADD COLUMN password TEXT DEFAULT ''")
    if "win" not in player_cols:
        db.execute("ALTER TABLE players ADD COLUMN win INTEGER NOT NULL DEFAULT 0")
    if "lose" not in player_cols:
        db.execute("ALTER TABLE players ADD COLUMN lose INTEGER NOT NULL DEFAULT 0")

    db.execute("UPDATE players SET win = 0 WHERE win IS NULL")
    db.execute("UPDATE players SET lose = 0 WHERE lose IS NULL")
    db.execute("UPDATE players SET password = '' WHERE password IS NULL")
    db.commit()
    db.close()


init_db()


def open_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_player(conn, username):
    """Make sure a fighter row exists. Returns False for junk display names."""
    if not username or username in ("Waiting...", "Host", "Opponent", "You", "BOT"):
        return False
    row = conn.execute(
        "SELECT 1 FROM players WHERE username = ?", (username,)
    ).fetchone()
    if row:
        return True
    conn.execute(
        "INSERT INTO players (username, password, win, lose) VALUES (?, '', 0, 0)",
        (username,),
    )
    return True


def list_ranked_fighters():
    conn = open_db()
    rows = conn.execute(
        """
        SELECT id, username, COALESCE(win, 0) AS win, COALESCE(lose, 0) AS lose
        FROM players
        WHERE username NOT IN ('BOT', 'You')
        ORDER BY win DESC, lose ASC, username ASC
        """
    ).fetchall()
    conn.close()
    return rows


# ---------- Room helpers ----------
def create_room_in_db(room_id, host_username):
    db = sqlite3.connect(DATABASE)
    db.execute(
        """
        INSERT INTO rooms (room_id, host_sid, joiner_sid, host_username, joiner_username)
        VALUES (?, NULL, NULL, ?, NULL)
        """,
        (room_id, host_username),
    )
    db.commit()
    db.close()


def get_room(room_id):
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (room_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "room_id": row["room_id"],
        "host_sid": row["host_sid"],
        "joiner_sid": row["joiner_sid"],
        "host_username": row["host_username"],
        "joiner_username": row["joiner_username"],
    }


def claim_joiner(room_id, username):
    db = sqlite3.connect(DATABASE)
    cur = db.execute(
        """
        UPDATE rooms
        SET joiner_username = ?
        WHERE room_id = ? AND joiner_username IS NULL AND host_username != ?
        """,
        (username, room_id, username),
    )
    db.commit()
    ok = cur.rowcount == 1
    db.close()
    return ok


def update_room_sid(room_id, role, sid):
    db = sqlite3.connect(DATABASE)
    if role == "host":
        db.execute("UPDATE rooms SET host_sid = ? WHERE room_id = ?", (sid, room_id))
    else:
        db.execute("UPDATE rooms SET joiner_sid = ? WHERE room_id = ?", (sid, room_id))
    db.commit()
    db.close()


def delete_room(room_id):
    db = sqlite3.connect(DATABASE)
    db.execute("DELETE FROM rooms WHERE room_id = ?", (room_id,))
    db.commit()
    db.close()


def end_match_for_peer(room_id, leaving_sid, reason="disconnect"):
    """Tell the remaining player the match is over, then drop the room."""
    room = get_room(room_id)
    if not room:
        return

    if room["host_sid"] == leaving_sid:
        peer_sid = room["joiner_sid"]
        winner = room["joiner_username"]
        loser = room["host_username"]
    elif room["joiner_sid"] == leaving_sid:
        peer_sid = room["host_sid"]
        winner = room["host_username"]
        loser = room["joiner_username"]
    else:
        delete_room(room_id)
        return

    if peer_sid and winner and loser:
        emit(
            "opponent_left",
            {"reason": reason, "winner": winner, "loser": loser},
            to=peer_sid,
        )

    delete_room(room_id)


def socket_username():
    return session.get("username")


def require_socket_user():
    username = socket_username()
    if not username:
        return None
    return username


def is_password_hashed(value):
    return isinstance(value, str) and value.startswith(("pbkdf2:", "scrypt:", "argon2:"))


def validate_username(username):
    return bool(username and USERNAME_RE.match(username))


# ---------- Routes ----------
@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "GET":
        return render_template("index.html", fighters=list_ranked_fighters())

    username1 = request.form.get("username1")
    username2 = request.form.get("username2")
    game_mode = request.form.get("mode")
    if not username1 or not username2:
        return render_template("index.html", fighters=list_ranked_fighters())

    # Guest AI-bot: display names only — no player rows, no ranking.
    if game_mode == "bot":
        return render_template(
            "arcadeFight.html",
            player_one_html="You",
            player_two_html="BOT",
            game_mode="bot",
        )

    conn = open_db()
    ensure_player(conn, username1)
    ensure_player(conn, username2)
    conn.commit()
    conn.close()
    return render_template(
        "arcadeFight.html",
        player_one_html=username1,
        player_two_html=username2,
        game_mode=game_mode,
    )


@app.route("/auth", methods=["POST"])
def auth():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    action = data.get("action")

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"})
    if not validate_username(username):
        return jsonify(
            {
                "success": False,
                "message": "Username must be 3-20 letters, numbers, or _",
            }
        )
    if len(password) < 4 or len(password) > 72:
        return jsonify({"success": False, "message": "Password must be 4-72 characters"})

    db = sqlite3.connect(DATABASE)
    c = db.cursor()
    if action == "register":
        c.execute("SELECT username FROM players WHERE username = ?", (username,))
        if c.fetchone():
            db.close()
            return jsonify({"success": False, "message": "Username already exists"})
        c.execute(
            "INSERT INTO players (username, password, win, lose) VALUES (?, ?, 0, 0)",
            (username, generate_password_hash(password)),
        )
        db.commit()
    elif action == "login":
        c.execute(
            "SELECT username, password FROM players WHERE username = ?",
            (username,),
        )
        row = c.fetchone()
        if not row:
            db.close()
            return jsonify({"success": False, "message": "Invalid credentials"})

        stored = row[1] or ""
        if is_password_hashed(stored):
            if not check_password_hash(stored, password):
                db.close()
                return jsonify({"success": False, "message": "Invalid credentials"})
        else:
            # migrate legacy plaintext passwords on successful login
            if stored != password:
                db.close()
                return jsonify({"success": False, "message": "Invalid credentials"})
            c.execute(
                "UPDATE players SET password = ? WHERE username = ?",
                (generate_password_hash(password), username),
            )
            db.commit()
    else:
        db.close()
        return jsonify({"success": False, "message": "Invalid action"})

    session["username"] = username
    db.close()
    return jsonify({"success": True, "username": username})


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("username", None)
    return jsonify({"success": True})


@app.route("/current_user")
def current_user():
    if "username" in session:
        return jsonify({"username": session["username"]})
    return jsonify({"username": None})


@app.route("/rank", methods=["GET", "POST"])
def rank():
    if request.method == "POST":
        return redirect("/")
    # Keep a real page as backup; club home also embeds the same list.
    return render_template("rank.html", fighters=list_ranked_fighters())


@app.route("/arcadeFight")
def arcadeFight():
    if "username" not in session:
        return redirect("/")

    username = session["username"]
    room = request.args.get("room")
    player = request.args.get("player")

    if room and player:
        room_data = get_room(room)
        if room_data:
            player_one_name = room_data["host_username"] or username
            player_two_name = room_data["joiner_username"] or "Waiting..."
        elif player == "host":
            player_one_name = username
            player_two_name = "Waiting..."
        else:
            player_one_name = "Waiting..."
            player_two_name = username
        game_mode = "online"
    else:
        player_one_name = "Player 1"
        player_two_name = "Player 2"
        game_mode = "local"

    return render_template(
        "arcadeFight.html",
        player_one_html=player_one_name,
        player_two_html=player_two_name,
        game_mode=game_mode,
        room=room,
        player_role=player,
    )


@app.route("/arcadeFight", methods=["POST"])
def arcadeFight_post():
    return redirect("/")


@app.route("/result", methods=["POST"])
def result():
    if "username" not in session:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    payload = request.get_json(silent=True)
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not payload:
        return jsonify({"success": False, "message": "Missing result"}), 400

    winner = (payload.get("winner") or "").strip()
    loser = (payload.get("loser") or "").strip()
    if not winner or not loser or winner == loser:
        return jsonify({"success": False, "message": "Invalid result"}), 400
    if winner in ("Waiting...", "Host", "Opponent", "You", "BOT") or loser in (
        "Waiting...",
        "Host",
        "Opponent",
        "You",
        "BOT",
    ):
        return jsonify({"success": False, "message": "Invalid result"}), 400

    me = session["username"]
    # Session user must be in the match (BOT is the only allowed non-account foe).
    if me not in (winner, loser):
        return jsonify({"success": False, "message": "Not a match participant"}), 403

    key = (winner, loser)
    now = time.time()
    last = _recent_scores.get(key)
    if last is not None and now - last < _SCORE_DEDUP_SEC:
        return jsonify({"success": True, "deduped": True})
    _recent_scores[key] = now

    conn = open_db()
    ensure_player(conn, winner)
    ensure_player(conn, loser)
    conn.execute(
        "UPDATE players SET win = COALESCE(win, 0) + 1 WHERE username = ?",
        (winner,),
    )
    conn.execute(
        "UPDATE players SET lose = COALESCE(lose, 0) + 1 WHERE username = ?",
        (loser,),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


def login_required_api(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "message": "Not logged in"}), 401
        return f(*args, **kwargs)

    return decorated


@app.route("/create_room", methods=["POST"])
@login_required_api
def create_room():
    room_id = str(uuid.uuid4())[:8]
    create_room_in_db(room_id, session["username"])
    return {"room_id": room_id}


@app.route("/join_room", methods=["POST"])
@login_required_api
def join_room_route():
    data = request.get_json() or {}
    room_id = data.get("room_id")
    if not room_id:
        return {"success": False, "message": "Room code required"}

    room = get_room(room_id)
    if not room:
        return {"success": False, "message": "Room not found"}
    if room["host_username"] == session["username"]:
        return {"success": False, "message": "Cannot join your own room"}
    if room["joiner_username"]:
        return {"success": False, "message": "Room is full"}

    if not claim_joiner(room_id, session["username"]):
        return {"success": False, "message": "Room not found or full"}
    return {"success": True}


# ---------- Socket.IO events ----------
@socketio.on("connect")
def handle_connect():
    if not socket_username():
        return False
    print("Client connected", request.sid, socket_username())


@socketio.on("join_game")
def handle_join_game(data):
    username = require_socket_user()
    if not username:
        return

    room_id = data.get("room")
    player_role = data.get("player")
    if not room_id or player_role not in ("host", "joiner"):
        return

    room = get_room(room_id)
    if not room:
        emit("join_error", {"message": "Room not found"})
        return

    if player_role == "host" and room["host_username"] != username:
        emit("join_error", {"message": "Not the host of this room"})
        return
    if player_role == "joiner" and room["joiner_username"] != username:
        emit("join_error", {"message": "Not the joiner of this room"})
        return

    join_room(room_id)
    update_room_sid(room_id, player_role, request.sid)

    room = get_room(room_id)
    if room and room["host_sid"] and room["joiner_sid"]:
        emit(
            "both_joined",
            {"host": room["host_username"], "joiner": room["joiner_username"]},
            room=room_id,
        )


@socketio.on("player_action")
def handle_player_action(data):
    if not require_socket_user():
        return
    room_id = data.get("room")
    action = data.get("action")
    if not room_id or action is None:
        return
    emit("opponent_action", action, room=room_id, skip_sid=request.sid)


@socketio.on("game_state")
def handle_game_state(data):
    if not require_socket_user():
        return
    room_id = data.get("room")
    state = data.get("state")
    if not room_id or state is None:
        return
    emit("game_state_update", state, room=room_id, skip_sid=request.sid)


@socketio.on("pause_request")
def handle_pause_request(data):
    if not require_socket_user():
        return
    room_id = data.get("room")
    if not room_id:
        return
    emit("pause_request", data, room=room_id, skip_sid=request.sid)


@socketio.on("pause_sync")
def handle_pause_sync(data):
    if not require_socket_user():
        return
    room_id = data.get("room")
    if not room_id:
        return
    emit("pause_sync", data, room=room_id, skip_sid=request.sid)


@socketio.on("leave_match")
def handle_leave_match(data):
    if not require_socket_user():
        return
    room_id = (data or {}).get("room")
    if not room_id:
        return
    room = get_room(room_id)
    if not room:
        return
    if request.sid not in (room["host_sid"], room["joiner_sid"]):
        return
    end_match_for_peer(room_id, request.sid, reason="leave")


@socketio.on("disconnect")
def handle_disconnect(reason=None):
    db = sqlite3.connect(DATABASE)
    rows = db.execute(
        "SELECT room_id FROM rooms WHERE host_sid = ? OR joiner_sid = ?",
        (request.sid, request.sid),
    ).fetchall()
    db.close()
    for (room_id,) in rows:
        end_match_for_peer(room_id, request.sid, reason=reason or "disconnect")
        break


if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
