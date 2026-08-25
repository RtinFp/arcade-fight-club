import eventlet

eventlet.monkey_patch()

import sqlite3
import json
from functools import wraps
from flask import Flask, redirect, render_template, request, g, session, jsonify
import uuid
from flask_socketio import SocketIO, join_room, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = "your-secret-key"
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="eventlet",
    ping_timeout=30,
    ping_interval=15,
    max_http_buffer_size=10e6,
)

# ---------- Database setup ----------
DATABASE = "fightClub.db"


def get_db():
    """Connect to the database for the current request/context."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_rooms_table():
    """Create the rooms table if it doesn't exist."""
    with app.app_context():
        db = sqlite3.connect(DATABASE)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                room_id TEXT PRIMARY KEY,
                host_sid TEXT,
                joiner_sid TEXT
            )
        """
        )
        db.commit()
        db.close()


# Create the table when the app starts
init_rooms_table()


# ---------- Room helpers ----------
def create_room_in_db(room_id):
    db = sqlite3.connect(DATABASE)
    db.execute(
        "INSERT INTO rooms (room_id, host_sid, joiner_sid) VALUES (?, NULL, NULL)",
        (room_id,),
    )
    db.commit()
    db.close()


def get_room(room_id):
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row  # <-- این خط حیاتی است
    row = conn.execute("SELECT * FROM rooms WHERE room_id = ?", (room_id,)).fetchone()
    conn.close()
    if row:
        return {"host_sid": row["host_sid"], "joiner_sid": row["joiner_sid"]}
    return None


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


# ---------- Routes ----------
@app.route("/", methods=["GET", "POST"])
def index():
    connect = sqlite3.connect("fightClub.db", check_same_thread=False)
    c = connect.cursor()
    if request.method == "GET":
        return render_template("index.html")
    else:
        username1 = request.form.get("username1")
        username2 = request.form.get("username2")
        game_mode = request.form.get("mode")
        if not username1 or not username2:
            return render_template("index.html")
        c.execute("SELECT username FROM players")
        results = c.fetchall()
        existing_usernames = [row[0] for row in results]
        if username1 not in existing_usernames:
            c.execute("INSERT INTO players (username) VALUES (?)", (username1,))
        if username2 not in existing_usernames:
            c.execute("INSERT INTO players (username) VALUES (?)", (username2,))
        connect.commit()
        connect.close()
        return render_template(
            "arcadeFight.html",
            player_one_html=username1,
            player_two_html=username2,
            game_mode=game_mode,
        )


@app.route("/auth", methods=["POST"])
def auth():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    action = data.get("action")  # "login" or "register"

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"})

    db = sqlite3.connect(DATABASE)
    c = db.cursor()
    if action == "register":
        c.execute("SELECT username FROM players WHERE username = ?", (username,))
        if c.fetchone():
            return jsonify({"success": False, "message": "Username already exists"})
        c.execute(
            "INSERT INTO players (username, password, win, lose) VALUES (?, ?, 0, 0)",
            (username, password),
        )
        db.commit()
    elif action == "login":
        c.execute(
            "SELECT username FROM players WHERE username = ? AND password = ?",
            (username, password),
        )
        if not c.fetchone():
            return jsonify({"success": False, "message": "Invalid credentials"})
    else:
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
        return render_template("index.html")
    else:
        connect = sqlite3.connect("fightClub.db", check_same_thread=False)
        connect.row_factory = sqlite3.Row
        c = connect.cursor()
        c.execute("SELECT * FROM players ORDER BY win DESC, lose ASC")
        fighters = c.fetchall()
        connect.close()
        return render_template("rank.html", fighters=fighters)


@app.route("/arcadeFight")
def arcadeFight():
    if "username" not in session:
        return redirect("/")

    username = session["username"]
    room = request.args.get("room")
    player = request.args.get("player")  # "host" or "joiner"

    if room and player:
        if player == "host":
            player_one_name = username
            player_two_name = "Opponent"
        else:
            player_one_name = "Host"
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
    connect = sqlite3.connect("fightClub.db", check_same_thread=False)
    c = connect.cursor()
    output = request.get_json()
    # توجه: output قبلاً JSON است، اما اینجا دوباره json.loads می‌کنید
    # بهتر است مستقیم از output استفاده کنید
    if isinstance(output, str):
        result = json.loads(output)
    else:
        result = output
    winnerpy = result["winner"]
    loserpy = result["loser"]
    c.execute("UPDATE players SET win = win + 1 WHERE username = ?", (winnerpy,))
    c.execute("UPDATE players SET lose = lose + 1 WHERE username = ?", (loserpy,))
    connect.commit()
    connect.close()
    return render_template("index.html")


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
    create_room_in_db(room_id)
    return {"room_id": room_id}


@app.route("/join_room", methods=["POST"])
@login_required_api
def join_room_route():
    data = request.get_json()
    room_id = data.get("room_id")
    room = get_room(room_id)
    if room and room["joiner_sid"] is None:
        return {"success": True}
    else:
        return {"success": False, "message": "Room not found or full"}


# ---------- Socket.IO events ----------
@socketio.on("connect")
def handle_connect():
    print("Client connected", request.sid)


@socketio.on("join_game")
def handle_join_game(data):
    room_id = data["room"]
    player_role = data["player"]
    join_room(room_id)
    update_room_sid(room_id, player_role, request.sid)

    room = get_room(room_id)
    if room and room["host_sid"] and room["joiner_sid"]:
        emit("both_joined", room=room_id)


@socketio.on("player_action")
def handle_player_action(data):
    room_id = data["room"]
    action = data["action"]
    emit("opponent_action", action, room=room_id, skip_sid=request.sid)


@socketio.on("game_state")
def handle_game_state(data):
    room_id = data["room"]
    state = data["state"]
    emit("game_state_update", state, room=room_id, skip_sid=request.sid)


@socketio.on("disconnect")
def handle_disconnect(reason=None):
    db = sqlite3.connect(DATABASE)
    rows = db.execute(
        "SELECT room_id FROM rooms WHERE host_sid = ? OR joiner_sid = ?",
        (request.sid, request.sid),
    ).fetchall()
    db.close()
    for (room_id,) in rows:
        emit("opponent_disconnected", room=room_id)
        delete_room(room_id)
        break


if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
