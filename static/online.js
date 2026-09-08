import {
    player_one,
    player_two,
    gameState,
    TICK_MS,
} from "./core.js";
import { reportMatchResult } from "./results.js";
import { playerActions } from "./input.js";
import { ACTIONS, STANDARD_MAPPING } from "./inputMapping.js";

let socket = null;
let roomId;
let isHost;
let narrator_title;
let tyler_title;
let connectionAlive = true;
let matchEnded = false;
let stateSeq = 0;
let lastInputSnapshotTime = 0;

const SEND_EVERY_TICKS = 1; // 60 Hz snapshots — fighter netcode wants this
const INPUT_SNAPSHOT_INTERVAL = 100;
const INTERP_DELAY_MS = 80; // sit this far behind the latest host tick
const MIN_BUFFER_SNAPSHOTS = 5;
const MAX_SNAPSHOTS = 24;
const MAX_EXTRAPOLATE_TICKS = 4;
const PLAYBACK_CORRECT = 0.1;

const joinerHeld = {
    left: false,
    right: false,
    block: false,
};

const snapshotBuffer = [];
// Playback time in host sim-ms (seq * TICK_MS), not performance.now().
let playbackTime = null;
let bufferReady = false;
let simTick = 0;

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
    remote.block = false;
}

function endMatchFromPeerLeave(data) {
    // Real KO already happened — don't turn a Club/OK leave into a second trophy.
    if (matchEnded || gameState.gameOver) {
        matchEnded = true;
        connectionAlive = false;
        return;
    }
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
        reportMatchResult(winner, loser);
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
        remote.block = !!s.block;
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
            case ACTIONS.BLOCK:
                remote.block = true;
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
            case ACTIONS.BLOCK:
                remote.block = false;
                break;
        }
    }
}

function packPlayer(player) {
    return {
        x: player.position.x,
        y: player.position.y,
        vx: player.velocity.x,
        vy: player.velocity.y,
        health: player.health,
        power: player.power_c,
        facing: player.facing,
        sprite: getSpriteName(player),
        frame: player.frames_current,
        blocking: !!player.blocking,
        blockFlash: player.blockFlashTicks > 0,
        dodgeFlash: player.dodgeFlashTicks > 0,
    };
}

function pushSnapshot(state) {
    if (typeof state.seq !== "number") return;
    if (snapshotBuffer.length && state.seq <= snapshotBuffer[snapshotBuffer.length - 1].seq) {
        return;
    }
    if (typeof state.t !== "number") {
        state.t = state.seq * TICK_MS;
    }
    snapshotBuffer.push(state);
    while (snapshotBuffer.length > MAX_SNAPSHOTS) {
        snapshotBuffer.shift();
    }
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpPlayer(older, newer, t, disc) {
    return {
        x: lerp(older.x, newer.x, t),
        y: lerp(older.y, newer.y, t),
        vx: disc.vx || 0,
        vy: disc.vy || 0,
        health: disc.health,
        power: disc.power,
        facing: disc.facing,
        sprite: disc.sprite,
        frame: disc.frame || 0,
        blocking: !!disc.blocking,
        blockFlash: !!disc.blockFlash,
        dodgeFlash: !!disc.dodgeFlash,
    };
}

function extrapolatePlayer(p, ticks) {
    return {
        ...p,
        x: p.x + (p.vx || 0) * ticks,
        y: p.y + (p.vy || 0) * ticks,
    };
}

function sampleBufferedState(renderTime) {
    if (snapshotBuffer.length === 0) return null;
    if (snapshotBuffer.length === 1) {
        const only = snapshotBuffer[0];
        if (renderTime <= only.t) return only;
        const ticks = Math.min(MAX_EXTRAPOLATE_TICKS, (renderTime - only.t) / TICK_MS);
        return {
            ...only,
            p1: extrapolatePlayer(only.p1, ticks),
            p2: extrapolatePlayer(only.p2, ticks),
        };
    }

    const oldest = snapshotBuffer[0];
    const newest = snapshotBuffer[snapshotBuffer.length - 1];

    if (renderTime <= oldest.t) return oldest;

    if (renderTime >= newest.t) {
        const ticks = Math.min(MAX_EXTRAPOLATE_TICKS, (renderTime - newest.t) / TICK_MS);
        return {
            ...newest,
            p1: extrapolatePlayer(newest.p1, ticks),
            p2: extrapolatePlayer(newest.p2, ticks),
        };
    }

    let older = oldest;
    let newer = newest;
    for (let i = 0; i < snapshotBuffer.length - 1; i++) {
        if (snapshotBuffer[i].t <= renderTime && snapshotBuffer[i + 1].t >= renderTime) {
            older = snapshotBuffer[i];
            newer = snapshotBuffer[i + 1];
            break;
        }
    }

    const span = newer.t - older.t;
    if (span <= 0) return newer;
    const t = (renderTime - older.t) / span;
    const disc = t < 0.5 ? older : newer;
    return {
        p1: lerpPlayer(older.p1, newer.p1, t, disc.p1),
        p2: lerpPlayer(older.p2, newer.p2, t, disc.p2),
        fightActive: disc.fightActive,
        gameOver: disc.gameOver,
        winner: disc.winner,
        t: renderTime,
        seq: newer.seq,
    };
}

function applyPose(player, pose) {
    player.position.x = pose.x;
    player.position.y = pose.y;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.health = pose.health;
    player.power_c = pose.power;
    player.facing = pose.facing;
    player.blocking = !!pose.blocking;
    player.blockFlashTicks = pose.blockFlash ? 2 : 0;
    player.dodgeFlashTicks = pose.dodgeFlash ? 2 : 0;
    player.applyRemoteVisual(pose.sprite, pose.frame);
}

function applyRenderedState(state) {
    applyPose(player_one, state.p1);
    applyPose(player_two, state.p2);
    applyUiBars(state);
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
    if (matchEnded || gameState.gameOver) return;

    const p1Dead = Number(state.p1 && state.p1.health) <= 0;
    const p2Dead = Number(state.p2 && state.p2.health) <= 0;
    if (!state.gameOver || (!p1Dead && !p2Dead)) return;
    if (typeof state.winner !== "string" || !state.winner) return;

    gameState.fight = false;
    gameState.gameOver = true;

    document.querySelector("#log").style.display = "flex";
    document.querySelector("#log_title").innerHTML = state.winner + " wins!";
    const p1Name = window.PLAYER_ONE_NAME || narrator_title;
    const p2Name = window.PLAYER_TWO_NAME || tyler_title;
    if (state.winner === p1Name) {
        // Host already posted the score from the sim tick.
        reportMatchResult(p1Name, p2Name, { record: false });
    } else {
        reportMatchResult(p2Name, p1Name, { record: false });
    }
}

function resetJoinerBuffer() {
    snapshotBuffer.length = 0;
    playbackTime = null;
    bufferReady = false;
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
            block: joinerHeld.block,
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
    playbackTime = null;
    bufferReady = false;
    simTick = 0;
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
        // Drop waiting-room snapshots so the joiner doesn't replay 400ms of idle.
        if (!isHost) resetJoinerBuffer();
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
            if (action === ACTIONS.BLOCK) joinerHeld.block = true;

            const key = actionToKey(action);
            if (key) {
                emitJoinerAction({ type: "down", key });
            }
            if (
                action === ACTIONS.LEFT ||
                action === ACTIONS.RIGHT ||
                action === ACTIONS.BLOCK
            ) {
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
            if (action === ACTIONS.BLOCK) joinerHeld.block = false;

            if (
                action === ACTIONS.LEFT ||
                action === ACTIONS.RIGHT ||
                action === ACTIONS.BLOCK
            ) {
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
    simTick += 1;
    if (simTick % SEND_EVERY_TICKS !== 0) return;
    stateSeq = simTick;

    let winner = null;
    const p1Name = window.PLAYER_ONE_NAME || narrator_title;
    const p2Name = window.PLAYER_TWO_NAME || tyler_title;
    if (player_one.health <= 0) winner = p2Name;
    else if (player_two.health <= 0) winner = p1Name;

    const state = {
        seq: stateSeq,
        t: simTick * TICK_MS,
        p1: packPlayer(player_one),
        p2: packPlayer(player_two),
        fightActive: gameState.fight,
        gameOver: player_one.health <= 0 || player_two.health <= 0,
        winner,
    };
    socket.emit("game_state", { room: roomId, state });

    if (state.gameOver && document.getElementById("log").style.display !== "flex") {
        document.querySelector("#log").style.display = "flex";
        document.querySelector("#log_title").innerHTML = winner + " wins!";
        // Score is posted from the host sim loop; this only fills local UI state.
        if (winner === p1Name) {
            reportMatchResult(p1Name, p2Name, { record: false });
        } else {
            reportMatchResult(p2Name, p1Name, { record: false });
        }
        gameState.fight = false;
        gameState.gameOver = true;
    }
}

export function updateOnlineJoiner(frameMs = TICK_MS) {
    if (isHost || matchEnded) return;
    sendInputSnapshot(false);

    const newest = snapshotBuffer[snapshotBuffer.length - 1];
    if (!newest) return;

    applyGameOverFromState(newest);

    const oldest = snapshotBuffer[0];
    const span = newest.t - oldest.t;
    const dt = Math.max(0, Math.min(50, frameMs));

    if (frameMs > 80 && bufferReady) {
        playbackTime = newest.t - INTERP_DELAY_MS;
    }

    if (!bufferReady) {
        if (snapshotBuffer.length >= MIN_BUFFER_SNAPSHOTS && span >= INTERP_DELAY_MS) {
            bufferReady = true;
            playbackTime = newest.t - INTERP_DELAY_MS;
            if (playbackTime < oldest.t) playbackTime = oldest.t;
        } else {
            applyRenderedState(newest);
            return;
        }
    }

    if (playbackTime == null) {
        playbackTime = newest.t - INTERP_DELAY_MS;
    } else {
        playbackTime += dt;
        const target = newest.t - INTERP_DELAY_MS;
        playbackTime += (target - playbackTime) * PLAYBACK_CORRECT;
    }

    if (playbackTime < oldest.t) playbackTime = oldest.t;

    const maxAhead = TICK_MS * MAX_EXTRAPOLATE_TICKS;
    if (playbackTime > newest.t + maxAhead) playbackTime = newest.t + maxAhead;

    const state = sampleBufferedState(playbackTime) || newest;
    applyRenderedState(state);
}
