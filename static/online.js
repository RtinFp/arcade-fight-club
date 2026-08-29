import {
    player_one,
    player_two,
    gameState,
    setMatchResult,
} from "./core.js";
import { playerActions } from "./input.js";
import { ACTIONS, STANDARD_MAPPING } from "./inputMapping.js";

let socket = null;
let roomId;
let isHost;
let narrator_title;
let tyler_title;
let connectionAlive = true;
let matchEnded = false;
let lastSendTime = 0;
let stateSeq = 0;
let lastInputSnapshotTime = 0;

const SEND_INTERVAL = 33; // ~30 Hz snapshots
const INPUT_SNAPSHOT_INTERVAL = 100;
const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 8;

const joinerHeld = {
    left: false,
    right: false,
};

const snapshotBuffer = [];
let lastSprites = { p1: "", p2: "" };

function actionToKey(action) {
    for (const [code, act] of Object.entries(STANDARD_MAPPING)) {
        if (act === action) return code.replace("Key", "").toLowerCase();
    }
    return null;
}

function keyToAction(keyStr) {
    const code = "Key" + keyStr.toUpperCase();
    return STANDARD_MAPPING[code];
}

function getSpriteName(player) {
    if (player.image === player.sprites.hit.image) return "hit";
    if (player.image === player.sprites.kick.image) return "kick";
    if (player.image === player.sprites.getHit.image) return "getHit";
    if (player.image === player.sprites.run.image) return "run";
    if (player.image === player.sprites.return.image) return "return";
    if (player.image === player.sprites.jump.image) return "jump";
    return "idle";
}

function applyHudNames(hostName, joinerName) {
    if (hostName) {
        narrator_title = hostName;
        window.PLAYER_ONE_NAME = hostName;
        const el = document.querySelector(".narrator_title");
        if (el) el.innerText = hostName;
    }
    if (joinerName) {
        tyler_title = joinerName;
        window.PLAYER_TWO_NAME = joinerName;
        const el = document.querySelector(".tyler_title");
        if (el) el.innerText = joinerName;
    }
}

function clearRemoteInputs() {
    const remote = playerActions.player_two;
    remote.left = false;
    remote.right = false;
    remote.jump = false;
    remote.melee = false;
    remote.special = false;
}

function endMatchFromPeerLeave(data) {
    if (matchEnded) return;
    matchEnded = true;
    connectionAlive = false;
    gameState.fight = false;
    gameState.gameOver = true;
    clearRemoteInputs();

    const ready = document.getElementById("ready");
    if (ready) ready.style.display = "none";

    const winner = data && data.winner;
    const loser = data && data.loser;
    const log = document.querySelector("#log");
    const title = document.querySelector("#log_title");
    if (log) log.style.display = "flex";

    if (winner && loser) {
        setMatchResult(winner, loser);
        if (title) {
            title.innerHTML = winner + " wins!<br><span style='font-size:0.55em'>opponent left</span>";
        }
    } else if (title) {
        title.innerHTML = "Opponent left";
    }
}

function showDisconnectMessage(msg) {
    endMatchFromPeerLeave(null);
    const title = document.querySelector("#log_title");
    if (title && msg) title.innerHTML = msg;
}

function applyRemoteAction(actionData) {
    if (!gameState.fight || gameState.gameOver) return;
    const remote = playerActions.player_two;

    // Absolute held-key sync only — one-shots stay on keydown events.
    if (actionData.type === "state" && actionData.state) {
        const s = actionData.state;
        remote.left = !!s.left;
        remote.right = !!s.right;
        return;
    }

    const action = keyToAction(actionData.key);
    if (!action) return;

    if (actionData.type === "down") {
        switch (action) {
            case ACTIONS.LEFT:
                remote.left = true;
                break;
            case ACTIONS.RIGHT:
                remote.right = true;
                break;
            case ACTIONS.JUMP:
                remote.jump = true;
                break;
            case ACTIONS.MELEE:
                remote.melee = true;
                break;
            case ACTIONS.SPECIAL:
                remote.special = true;
                break;
        }
    } else if (actionData.type === "up") {
        switch (action) {
            case ACTIONS.LEFT:
                remote.left = false;
                break;
            case ACTIONS.RIGHT:
                remote.right = false;
                break;
        }
    }
}

function pushSnapshot(state) {
    if (typeof state.seq !== "number") return;
    if (snapshotBuffer.length && state.seq <= snapshotBuffer[snapshotBuffer.length - 1].seq) {
        return;
    }
    snapshotBuffer.push(state);
    while (snapshotBuffer.length > MAX_SNAPSHOTS) {
        snapshotBuffer.shift();
    }
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function sampleBufferedState(renderTime) {
    if (snapshotBuffer.length === 0) return null;
    if (snapshotBuffer.length === 1) return snapshotBuffer[0];

    let older = snapshotBuffer[0];
    let newer = snapshotBuffer[snapshotBuffer.length - 1];

    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
        if (snapshotBuffer[i].t <= renderTime && snapshotBuffer[i + 1].t >= renderTime) {
            older = snapshotBuffer[i];
            newer = snapshotBuffer[i + 1];
            break;
        }
    }

    if (newer.t === older.t) return newer;
    const t = Math.max(0, Math.min(1, (renderTime - older.t) / (newer.t - older.t)));
    return {
        p1: {
            x: lerp(older.p1.x, newer.p1.x, t),
            y: lerp(older.p1.y, newer.p1.y, t),
            health: newer.p1.health,
            power: newer.p1.power,
            facing: newer.p1.facing,
            sprite: newer.p1.sprite,
        },
        p2: {
            x: lerp(older.p2.x, newer.p2.x, t),
            y: lerp(older.p2.y, newer.p2.y, t),
            health: newer.p2.health,
            power: newer.p2.power,
            facing: newer.p2.facing,
            sprite: newer.p2.sprite,
        },
        fightActive: newer.fightActive,
        gameOver: newer.gameOver,
        winner: newer.winner,
        t: renderTime,
        seq: newer.seq,
    };
}

function applyUiBars(state) {
    document.querySelector("#player_one_health_bar").style.width = state.p1.health + "%";
    document.querySelector("#player_two_health_bar").style.width = state.p2.health + "%";
    document.querySelector("#player_one_combo_bar").style.width = state.p1.power + "%";
    document.querySelector("#player_two_combo_bar").style.width = state.p2.power + "%";

    if (state.p1.power >= 50) document.getElementById("player_one_combo_bar").style.background = "yellow";
    if (state.p1.power >= 100) document.getElementById("player_one_combo_bar").style.background = "rgb(0,255,0)";
    if (state.p2.power >= 50) document.getElementById("player_two_combo_bar").style.background = "yellow";
    if (state.p2.power >= 100) document.getElementById("player_two_combo_bar").style.background = "rgb(0,255,0)";
}

function applyGameOverFromState(state) {
    gameState.fight = state.fightActive;
    gameState.gameOver = state.gameOver;

    if (state.gameOver && document.getElementById("log").style.display !== "flex") {
        document.querySelector("#log").style.display = "flex";
        document.querySelector("#log_title").innerHTML = state.winner + " wins!";
        const p1Name = window.PLAYER_ONE_NAME || narrator_title;
        const p2Name = window.PLAYER_TWO_NAME || tyler_title;
        if (state.winner === p1Name) {
            setMatchResult(p1Name, p2Name);
        } else {
            setMatchResult(p2Name, p1Name);
        }
    } else if (!state.gameOver) {
        document.querySelector("#log").style.display = "none";
    }
}

function applySprites(state) {
    if (state.p1.sprite !== lastSprites.p1) {
        player_one.switch_sprite(state.p1.sprite);
        lastSprites.p1 = state.p1.sprite;
    }
    if (state.p2.sprite !== lastSprites.p2) {
        player_two.switch_sprite(state.p2.sprite);
        lastSprites.p2 = state.p2.sprite;
    }
    player_one.facing = state.p1.facing;
    player_two.facing = state.p2.facing;
}

function emitJoinerAction(action) {
    if (!connectionAlive || !socket || !roomId) return;
    socket.emit("player_action", { room: roomId, action });
}

function sendInputSnapshot(force) {
    if (isHost || !connectionAlive) return;
    const now = Date.now();
    if (!force && now - lastInputSnapshotTime < INPUT_SNAPSHOT_INTERVAL) return;
    lastInputSnapshotTime = now;
    emitJoinerAction({
        type: "state",
        state: {
            left: joinerHeld.left,
            right: joinerHeld.right,
        },
    });
}

export function getSocket() {
    return socket;
}

export function getRoomId() {
    return roomId;
}

export function isOnlineConnected() {
    return connectionAlive && !!socket && !matchEnded;
}

export function isMatchEnded() {
    return matchEnded || gameState.gameOver;
}

export function emitPauseSync(paused) {
    if (!isOnlineConnected() || !roomId) return;
    socket.emit("pause_sync", { room: roomId, paused });
}

export function emitPauseRequest() {
    if (!isOnlineConnected() || !roomId) return;
    socket.emit("pause_request", { room: roomId });
}

export function leaveMatch(onDone) {
    if (matchEnded) {
        if (onDone) onDone();
        return;
    }
    matchEnded = true;
    gameState.fight = false;
    gameState.gameOver = true;
    clearRemoteInputs();

    const finish = () => {
        connectionAlive = false;
        if (onDone) onDone();
    };

    if (socket && roomId && connectionAlive) {
        socket.emit("leave_match", { room: roomId });
        // Give the leave packet a moment to flush before unload.
        setTimeout(finish, 200);
    } else {
        finish();
    }
}

export function initOnline(room, role, narrator, tyler) {
    roomId = room;
    isHost = role === "host";
    narrator_title = narrator;
    tyler_title = tyler;
    connectionAlive = true;
    matchEnded = false;
    snapshotBuffer.length = 0;
    stateSeq = 0;

    socket = io({ withCredentials: true });

    socket.on("connect_error", () => {
        showDisconnectMessage("Could not connect");
    });

    socket.on("join_error", (data) => {
        showDisconnectMessage((data && data.message) || "Join failed");
    });

    socket.emit("join_game", { room: roomId, player: role });

    socket.on("both_joined", (data) => {
        if (matchEnded) return;
        if (data) {
            applyHudNames(data.host, data.joiner);
        }
        gameState.fight = true;
        gameState.gameOver = false;
        document.getElementById("ready").style.display = "none";
        document.getElementById("song").play();
    });

    socket.on("opponent_left", (data) => {
        endMatchFromPeerLeave(data || {});
    });

    socket.on("opponent_disconnected", () => {
        endMatchFromPeerLeave({});
    });

    if (isHost) {
        socket.on("opponent_action", (actionData) => {
            applyRemoteAction(actionData);
        });

        socket.on("pause_request", () => {
            if (matchEnded || gameState.gameOver || !connectionAlive) return;
            if (gameState.fight) {
                gameState.fight = false;
                document.getElementById("ready").style.display = "flex";
                emitPauseSync(true);
            } else {
                gameState.fight = true;
                document.getElementById("ready").style.display = "none";
                document.getElementById("song").play();
                emitPauseSync(false);
            }
        });
    } else {
        socket.on("game_state_update", (state) => {
            if (matchEnded) return;
            pushSnapshot(state);
            applyUiBars(state);
            applyGameOverFromState(state);
            applySprites(state);
        });

        window.addEventListener("keydown", (e) => {
            const code = e.code;
            const action = STANDARD_MAPPING[code];
            if (!action) return;
            e.preventDefault();
            if (!connectionAlive) return;
            if (!gameState.fight || gameState.gameOver) return;

            if (action === ACTIONS.LEFT) joinerHeld.left = true;
            if (action === ACTIONS.RIGHT) joinerHeld.right = true;

            const key = actionToKey(action);
            if (key) {
                emitJoinerAction({ type: "down", key });
            }
            if (action === ACTIONS.LEFT || action === ACTIONS.RIGHT) {
                sendInputSnapshot(true);
            }
        });

        window.addEventListener("keyup", (e) => {
            const code = e.code;
            const action = STANDARD_MAPPING[code];
            if (!action || !connectionAlive) return;
            if (!gameState.fight || gameState.gameOver) return;

            if (action === ACTIONS.LEFT) joinerHeld.left = false;
            if (action === ACTIONS.RIGHT) joinerHeld.right = false;

            if (action === ACTIONS.LEFT || action === ACTIONS.RIGHT) {
                const key = actionToKey(action);
                if (key) emitJoinerAction({ type: "up", key });
                sendInputSnapshot(true);
            }
        });

        socket.on("pause_sync", (data) => {
            if (data.paused) {
                gameState.fight = false;
                document.getElementById("ready").style.display = "flex";
            } else {
                gameState.fight = true;
                document.getElementById("ready").style.display = "none";
                document.getElementById("song").play();
            }
        });
    }
}

export function updateOnlineHost() {
    if (!isHost || !connectionAlive || !socket || matchEnded) return;
    const now = Date.now();
    if (now - lastSendTime < SEND_INTERVAL) return;
    lastSendTime = now;
    stateSeq += 1;

    let winner = null;
    const p1Name = window.PLAYER_ONE_NAME || narrator_title;
    const p2Name = window.PLAYER_TWO_NAME || tyler_title;
    if (player_one.health <= 0) winner = p2Name;
    else if (player_two.health <= 0) winner = p1Name;

    const state = {
        seq: stateSeq,
        t: performance.now(),
        p1: {
            x: player_one.position.x,
            y: player_one.position.y,
            health: player_one.health,
            power: player_one.power_c,
            facing: player_one.facing,
            sprite: getSpriteName(player_one),
        },
        p2: {
            x: player_two.position.x,
            y: player_two.position.y,
            health: player_two.health,
            power: player_two.power_c,
            facing: player_two.facing,
            sprite: getSpriteName(player_two),
        },
        fightActive: gameState.fight,
        gameOver: player_one.health <= 0 || player_two.health <= 0,
        winner,
    };
    socket.emit("game_state", { room: roomId, state });

    if (state.gameOver && document.getElementById("log").style.display !== "flex") {
        document.querySelector("#log").style.display = "flex";
        document.querySelector("#log_title").innerHTML = winner + " wins!";
        if (winner === p1Name) {
            setMatchResult(p1Name, p2Name);
        } else {
            setMatchResult(p2Name, p1Name);
        }
        gameState.fight = false;
        gameState.gameOver = true;
    }
}

export function updateOnlineJoiner() {
    if (isHost || matchEnded) return;
    sendInputSnapshot(false);

    const latest = snapshotBuffer[snapshotBuffer.length - 1];
    if (!latest) return;

    const renderTime = latest.t - INTERP_DELAY_MS;
    const state = sampleBufferedState(renderTime) || latest;

    player_one.position.x = state.p1.x;
    player_one.position.y = state.p1.y;
    player_two.position.x = state.p2.x;
    player_two.position.y = state.p2.y;
    player_one.health = state.p1.health;
    player_one.power_c = state.p1.power;
    player_two.health = state.p2.health;
    player_two.power_c = state.p2.power;
    player_one.facing = state.p1.facing;
    player_two.facing = state.p2.facing;

    // Prevent leftover velocity from fighting network positions.
    player_one.velocity.x = 0;
    player_one.velocity.y = 0;
    player_two.velocity.x = 0;
    player_two.velocity.y = 0;
}
