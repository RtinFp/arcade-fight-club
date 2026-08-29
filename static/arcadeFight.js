import {
    matchResult,
    setMatchResult,
    melee_box,
    combo_box,
    background_img,
    city,
    flat,
    player_one,
    player_two,
    initGameObjects,
    flat_point,
    gameState,
    players_velocity,
    players_jump,
    TICK_MS,
} from "./core.js";
import { initInput, playerActions, resetJumpFlag, resetActionFlags } from "./input.js";
import { updateAI, setBotReferences } from "./bot.js";
import {
    initOnline,
    updateOnlineHost,
    updateOnlineJoiner,
    emitPauseSync,
    emitPauseRequest,
    leaveMatch,
    isOnlineConnected,
    isMatchEnded,
} from "./online.js";

let gameMode, narrator_title, tyler_title;

document.addEventListener("DOMContentLoaded", () => {
    gameMode = window.GAME_MODE || "local";
    narrator_title =
        window.PLAYER_ONE_NAME || document.querySelector(".narrator_title").innerHTML;
    tyler_title =
        window.PLAYER_TWO_NAME || document.querySelector(".tyler_title").innerHTML;

    initGameObjects();
    setBotReferences(player_one, player_two);

    const isHost = window.PLAYER_ROLE === "host";
    initInput(gameMode, isHost, window.PLAYER_ROLE, player_one, player_two);

    if (gameMode === "online") {
        initOnline(window.ROOM_ID, window.PLAYER_ROLE, narrator_title, tyler_title);
    }

    const fightButton = document.getElementById("fight");
    if (fightButton) {
        fightButton.addEventListener("click", () => {
            if (gameMode === "online") {
                if (!isOnlineConnected() || isMatchEnded()) return;
                if (window.PLAYER_ROLE === "host") {
                    gameState.fight = true;
                    document.getElementById("ready").style.display = "none";
                    document.getElementById("song").play();
                    emitPauseSync(false);
                } else {
                    emitPauseRequest();
                }
                return;
            }
            gameState.fight = true;
            gameState.gameOver = false;
            document.getElementById("ready").style.display = "none";
            document.getElementById("song").play();
        });
    }

    const leaveClubForm = document.getElementById("leaveClubForm");
    if (leaveClubForm) {
        leaveClubForm.addEventListener("submit", (e) => {
            if (gameMode !== "online") return;
            e.preventDefault();
            leaveMatch(() => {
                window.location.href = "/";
            });
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key !== " ") return;
        e.preventDefault();
        if (gameMode === "online") {
            if (!isOnlineConnected() || isMatchEnded()) return;
            if (window.PLAYER_ROLE === "host") {
                gameState.fight = !gameState.fight;
                if (!gameState.fight) {
                    document.getElementById("ready").style.display = "flex";
                    emitPauseSync(true);
                } else {
                    document.getElementById("ready").style.display = "none";
                    document.getElementById("song").play();
                    emitPauseSync(false);
                }
            } else {
                emitPauseRequest();
            }
        } else {
            gameState.fight = !gameState.fight;
            if (!gameState.fight) document.getElementById("ready").style.display = "flex";
            else {
                document.getElementById("ready").style.display = "none";
                document.getElementById("song").play();
            }
        }
    });

    // Browser close / refresh — best-effort; Club uses leaveMatch with a short delay.
    if (gameMode === "online") {
        window.addEventListener("pagehide", () => {
            leaveMatch();
        });
    }

    function processPlayer(player, actions, playerIndex) {
        player.velocity.x = 0;

        if (actions.left) {
            player.velocity.x = -players_velocity;
            player.switch_sprite("return");
            player.facing = -1;
        } else if (actions.right) {
            player.velocity.x = players_velocity;
            player.switch_sprite("run");
            player.facing = 1;
        } else if (!player.melee && !player.combo && player.velocity.y === 0) {
            player.switch_sprite("idle");
        }

        if (actions.jump) {
            const canvas = document.querySelector("canvas");
            if (player.position.y + player.height >= canvas.height - flat_point) {
                player.velocity.y = players_jump;
                const audio = new Audio();
                audio.src = "./static/sfx/jump.wav";
                audio.play();
            }
            resetJumpFlag(playerIndex === 0 ? "one" : "two");
        }

        if (actions.melee) {
            player.attack();
            resetActionFlags(playerIndex === 0 ? "one" : "two");
        }

        if (actions.special) {
            if (player.power_c >= 100) {
                if (playerIndex === 0) {
                    document.getElementById("player_one_combo_bar").style.background = "red";
                    document.getElementById("player_one_combo_bar").style.width = "0%";
                } else {
                    document.getElementById("player_two_combo_bar").style.background = "red";
                    document.getElementById("player_two_combo_bar").style.width = "0%";
                }
                player.power();
            }
            resetActionFlags(playerIndex === 0 ? "one" : "two");
        }

        if (player.velocity.y < 0) player.switch_sprite("jump");
    }

    function simulateTick() {
        if (gameMode === "online" && isMatchEnded()) {
            return;
        }

        if (gameState.fight && !gameState.gameOver) {
            processPlayer(player_one, playerActions.player_one, 0);

            if (gameMode === "bot") {
                updateAI();
                processPlayer(player_two, playerActions.player_two, 1);
            } else if (gameMode === "online" && window.PLAYER_ROLE === "host") {
                processPlayer(player_two, playerActions.player_two, 1);
            } else if (gameMode === "local") {
                processPlayer(player_two, playerActions.player_two, 1);
            }
        } else {
            player_one.velocity.x = 0;
            player_two.velocity.x = 0;
        }

        player_one.stepPhysics();
        player_two.stepPhysics();

        if (
            gameState.fight &&
            !gameState.gameOver &&
            (gameMode !== "online" || window.PLAYER_ROLE === "host")
        ) {
            if (melee_box({ box1: player_one, box2: player_two }) && player_one.melee) {
                player_two.hit();
                player_one.melee = false;
                player_one.meleeTicks = 0;
                player_one.power_c += 10;
                document.querySelector("#player_one_combo_bar").style.width =
                    player_one.power_c + "%";
                document.querySelector("#player_two_health_bar").style.width =
                    player_two.health + "%";
            }
            if (melee_box({ box1: player_two, box2: player_one }) && player_two.melee) {
                player_one.hit();
                player_two.melee = false;
                player_two.meleeTicks = 0;
                player_two.power_c += 10;
                document.querySelector("#player_two_combo_bar").style.width =
                    player_two.power_c + "%";
                document.querySelector("#player_one_health_bar").style.width =
                    player_one.health + "%";
            }

            if (combo_box({ box1: player_one, box2: player_two }) && player_one.combo) {
                player_one.combo = false;
                player_one.comboTicks = 0;
                player_two.heavyHit();
                document.querySelector("#player_two_health_bar").style.width =
                    player_two.health + "%";
            }
            if (combo_box({ box1: player_two, box2: player_one }) && player_two.combo) {
                player_two.combo = false;
                player_two.comboTicks = 0;
                player_one.heavyHit();
                document.querySelector("#player_one_health_bar").style.width =
                    player_one.health + "%";
            }

            if (player_one.power_c >= 50)
                document.getElementById("player_one_combo_bar").style.background = "yellow";
            if (player_one.power_c >= 100)
                document.getElementById("player_one_combo_bar").style.background = "rgb(0, 255, 0)";
            if (player_two.power_c >= 50)
                document.getElementById("player_two_combo_bar").style.background = "yellow";
            if (player_two.power_c >= 100)
                document.getElementById("player_two_combo_bar").style.background = "rgb(0, 255, 0)";

            if (player_one.health <= 0 || player_two.health <= 0) {
                if (!gameState.gameOver) {
                    gameState.gameOver = true;
                    gameState.fight = false;
                    const p1Name = window.PLAYER_ONE_NAME || narrator_title;
                    const p2Name = window.PLAYER_TWO_NAME || tyler_title;
                    const winner = player_one.health <= 0 ? p2Name : p1Name;
                    document.querySelector("#log").style.display = "flex";
                    document.querySelector("#log_title").innerHTML = winner + " wins!";
                    if (winner === p1Name) {
                        setMatchResult(p1Name, p2Name);
                    } else {
                        setMatchResult(p2Name, p1Name);
                    }
                }
            }
        }

        if (gameMode === "online" && window.PLAYER_ROLE === "host") {
            updateOnlineHost();
        }
    }

    function renderFrame() {
        const canvas = document.querySelector("canvas");
        const c = canvas.getContext("2d");
        c.clearRect(0, 0, canvas.width, canvas.height);

        background_img.update();
        city.update();
        city.buildings();
        flat.update();

        const isJoinerOnline = gameMode === "online" && window.PLAYER_ROLE !== "host";
        if (isJoinerOnline) {
            player_one.drawFrame();
            player_two.drawFrame();
        } else {
            player_one.draw();
            player_one.animate_frames();
            player_one.updateHitboxes();
            player_two.draw();
            player_two.animate_frames();
            player_two.updateHitboxes();
        }
    }

    let lastTime = performance.now();
    let accumulator = 0;

    function animate(now) {
        requestAnimationFrame(animate);

        const isJoinerOnline = gameMode === "online" && window.PLAYER_ROLE !== "host";
        const frameMs = Math.min(100, now - lastTime);
        lastTime = now;

        if (isJoinerOnline) {
            updateOnlineJoiner();
            renderFrame();
            return;
        }

        accumulator += frameMs;
        let steps = 0;
        while (accumulator >= TICK_MS && steps < 5) {
            simulateTick();
            accumulator -= TICK_MS;
            steps += 1;
        }

        renderFrame();
    }

    requestAnimationFrame(animate);
});

export { matchResult };
