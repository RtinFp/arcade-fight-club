// Fixed 60 Hz clock — physics, hit windows, and sprite timing all step here.
// (Variable dt is fine for some games; fighters stay saner on a fixed tick.)
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const MAX_FRAME_MS = 100; // clamp huge pauses (tab switch, debugger)
export const MAX_STEPS_PER_FRAME = 5; // avoid spiral-of-death catch-up
export const ATTACK_ACTIVE_TICKS = 6; // ~100 ms at 60 Hz

export const gravity = 1;
export const players_velocity = 15;
export const players_jump = -25;
export const melee_damage = 1;
export const combo_damage = 20;
export const flat_point = 106;
export const city_speed = 2;

// Mutable match outcome (avoid reassigning ES module bindings).
export const matchResult = {
    winner: null,
    loser: null,
};

export function setMatchResult(winner, loser) {
    matchResult.winner = winner;
    matchResult.loser = loser;
}

export function clearMatchResult() {
    matchResult.winner = null;
    matchResult.loser = null;
}

export const keys = {
    a: { pressed: false },
    f: { pressed: false },
    j: { pressed: false },
    semicolon: { pressed: false },
};

export const gameState = {
    fight: false,
    gameOver: false,
};

function spriteHold(sprite) {
    if (sprite === "getHit") return 5;
    if (sprite === "run" || sprite === "return") return 10;
    return 25;
}

export class Background {
    constructor({ position, img, scale = 1, frames_max = 1 }) {
        this.position = position;
        this.width = 50;
        this.height = 150;
        this.image = new Image();
        this.image.src = img;
        this.scale = scale;
        this.frames_max = frames_max;
        this.frames_current = 0;
        this.frames_elapsed = 0;
        this.frames_hold = 5;
    }
    draw() {
        const c = document.querySelector("canvas").getContext("2d");
        c.drawImage(
            this.image,
            this.frames_current * (this.image.width / this.frames_max),
            0,
            this.image.width / this.frames_max,
            this.image.height,
            this.position.x,
            this.position.y,
            (this.image.width / this.frames_max) * this.scale,
            this.image.height * this.scale
        );
    }
    animate_frames() {
        this.frames_elapsed++;
        if (this.frames_elapsed % this.frames_hold === 0) {
            this.frames_current =
                this.frames_current < this.frames_max - 1
                    ? this.frames_current + 1
                    : 0;
        }
    }
    // Draw only — animation advances on the fixed tick, not the paint rate.
    update() {
        this.draw();
    }
    buildings() {
        this.position.x += city_speed;
        if (this.position.x >= 0) this.position.x = -1920;
    }
}

export class Sprite extends Background {
    constructor({
        position,
        velocity,
        offset,
        offset2,
        color = "red",
        img,
        scale = 1,
        frames_max = 1,
        sprites,
    }) {
        super({ img, scale, frames_max, position });
        this.velocity = velocity;
        this.width = 150;
        this.height = 350;
        this.facing = 1;
        this.color = color;
        this.health = 100;
        this.power_c = 0;
        this.melee_base_offset = offset.x;
        this.combo_base_offset = offset2.x;
        this.melee_env = {
            position: { x: this.position.x, y: this.position.y },
            offset,
            width: 280,
            height: 50,
        };
        this.melee = false;
        this.meleeTicks = 0;
        this.combo_env = {
            position: { x: this.position.x, y: this.position.y },
            offset2,
            width: 600,
            height: 600,
        };
        this.combo = false;
        this.comboTicks = 0;
        this.frames_current = 0;
        this.frames_elapsed = 0;
        this.frames_hold = 10;
        this.sprites = sprites;
        for (const sprite in this.sprites) {
            sprites[sprite].image = new Image();
            sprites[sprite].image.src = sprites[sprite].img;
        }
    }

    draw() {
        const c = document.querySelector("canvas").getContext("2d");
        const shouldFlip =
            this.facing === -1 &&
            this.image !== this.sprites.run.image &&
            this.image !== this.sprites.return.image;

        if (shouldFlip) {
            c.save();
            c.translate(
                this.position.x + this.width / 2,
                this.position.y + this.height / 2
            );
            c.scale(-1, 1);
            c.translate(
                -(this.position.x + this.width / 2),
                -(this.position.y + this.height / 2)
            );
        }

        c.drawImage(
            this.image,
            this.frames_current * (this.image.width / this.frames_max),
            0,
            this.image.width / this.frames_max,
            this.image.height,
            this.position.x,
            this.position.y,
            (this.image.width / this.frames_max) * this.scale,
            this.image.height * this.scale
        );

        if (shouldFlip) {
            c.restore();
        }
    }

    updateHitboxes() {
        const forward = this.facing;
        const absMeleeOffset = Math.abs(this.melee_base_offset);
        const absComboOffset = Math.abs(this.combo_base_offset);
        this.melee_env.position.x = this.position.x + forward * absMeleeOffset;
        this.melee_env.position.y = this.position.y + this.melee_env.offset.y;
        this.combo_env.position.x = this.position.x + forward * absComboOffset;
        this.combo_env.position.y = this.position.y + this.combo_env.offset2.y;
    }

    // Joiner / remote paint path — animation is stepped by the shared clock.
    drawFrame() {
        this.draw();
        this.updateHitboxes();
    }

    tickAttackWindows() {
        if (this.meleeTicks > 0) {
            this.meleeTicks--;
            if (this.meleeTicks === 0) this.melee = false;
        }
        if (this.comboTicks > 0) {
            this.comboTicks--;
            if (this.comboTicks === 0) this.combo = false;
        }
    }

    stepPhysics() {
        const canvas = document.querySelector("canvas");
        this.position.x += this.velocity.x;
        this.position.y += this.velocity.y;

        if (
            this.position.y + this.height + this.velocity.y >=
            canvas.height - flat_point
        ) {
            this.velocity.y = 0;
        } else {
            this.velocity.y += gravity;
        }

        this.tickAttackWindows();
        this.updateHitboxes();
    }

    update() {
        this.draw();
        this.stepPhysics();
    }

    attack() {
        this.switch_sprite("hit");
        this.melee = true;
        this.meleeTicks = ATTACK_ACTIVE_TICKS;
    }

    power() {
        this.power_c = 0;
        this.switch_sprite("kick");
        this.combo = true;
        this.comboTicks = ATTACK_ACTIVE_TICKS;
    }

    hit() {
        this.switch_sprite("getHit");
        this.health -= melee_damage;
        const audio = new Audio();
        audio.src = "./static/sfx/hit.mp3";
        audio.play();
    }

    heavyHit() {
        this.switch_sprite("getHit");
        this.health -= combo_damage;
        const audio = new Audio();
        audio.src = "./static/sfx/combo.wav";
        audio.play();
    }

    switch_sprite(sprite) {
        if (
            this.image === this.sprites.hit.image &&
            this.frames_current < this.sprites.hit.frames_max - 1
        )
            return;
        if (
            this.image === this.sprites.kick.image &&
            this.frames_current < this.sprites.kick.frames_max - 1
        )
            return;
        if (
            this.image === this.sprites.getHit.image &&
            this.frames_current < this.sprites.getHit.frames_max - 1
        )
            return;
        let cfg;
        switch (sprite) {
            case "idle":
                cfg = this.sprites.idle;
                break;
            case "run":
                cfg = this.sprites.run;
                break;
            case "return":
                cfg = this.sprites.return;
                break;
            case "hit":
                cfg = this.sprites.hit;
                break;
            case "kick":
                cfg = this.sprites.kick;
                break;
            case "jump":
                cfg = this.sprites.jump;
                break;
            case "getHit":
                cfg = this.sprites.getHit;
                break;
            default:
                return;
        }
        if (this.image !== cfg.image) {
            this.image = cfg.image;
            this.frames_max = cfg.frames_max;
            this.frames_current = 0;
            this.frames_hold = spriteHold(sprite);
        }
    }

    // Joiner path: host is the authority, so skip the local attack lock and
    // just show whatever sheet + frame the snapshot says.
    applyRemoteVisual(spriteName, frame) {
        const cfg = this.sprites[spriteName] || this.sprites.idle;
        if (!cfg || !cfg.image) return;
        if (this.image !== cfg.image) {
            this.image = cfg.image;
            this.frames_max = cfg.frames_max;
            this.frames_hold = spriteHold(spriteName);
            this.frames_elapsed = 0;
        }
        const max = Math.max(0, this.frames_max - 1);
        const f = typeof frame === "number" && isFinite(frame) ? frame : 0;
        this.frames_current = Math.max(0, Math.min(f, max));
    }
}

export function melee_box({ box1, box2 }) {
    return (
        box1.melee_env.position.x + box1.melee_env.width >= box2.position.x &&
        box1.melee_env.position.x <= box2.position.x + box2.width &&
        box1.melee_env.position.y + box1.melee_env.height >= box2.position.y &&
        box1.melee_env.position.y <= box2.position.y + box2.height
    );
}

export function combo_box({ box1, box2 }) {
    return (
        box1.combo_env.position.x + box1.combo_env.width >= box2.position.x &&
        box1.combo_env.position.x <= box2.position.x + box2.width &&
        box1.combo_env.position.y + box1.combo_env.height >= box2.position.y &&
        box1.combo_env.position.y <= box2.position.y + box2.height
    );
}

export let background_img, city, flat, player_one, player_two;

export function initGameObjects() {
    background_img = new Background({
        position: { x: 0, y: 0 },
        img: "./static/img/back.png",
    });
    city = new Background({
        position: { x: -1920, y: 450 },
        img: "./static/img/cityPartCom.png",
    });
    flat = new Background({
        position: { x: 0, y: 560 },
        img: "./static/img/flat.png",
    });

    player_one = new Sprite({
        position: { x: 150, y: 70 },
        velocity: { x: 0, y: 3 },
        offset: { x: 0, y: 60 },
        offset2: { x: -250, y: -250 },
        img: "./static/img/narratorIdle.png",
        frames_max: 2,
        scale: 1.06,
        sprites: {
            idle: { img: "./static/img/narratorIdle.png", frames_max: 2 },
            run: { img: "./static/img/narratorRun.png", frames_max: 4 },
            return: { img: "./static/img/narratorReturn.png", frames_max: 4 },
            hit: { img: "./static/img/narratorHit.png", frames_max: 2 },
            kick: { img: "./static/img/narratorCombo.png", frames_max: 2 },
            jump: { img: "./static/img/narratorJump.png", frames_max: 2 },
            getHit: { img: "./static/img/narratorgetHit.png", frames_max: 3 },
        },
    });

    player_two = new Sprite({
        position: { x: 1640, y: 70 },
        velocity: { x: 0, y: 3 },
        offset: { x: -130, y: 60 },
        offset2: { x: -250, y: -250 },
        img: "./static/img/tylerIdle.png",
        frames_max: 2,
        scale: 1.06,
        sprites: {
            idle: { img: "./static/img/tylerIdle.png", frames_max: 2 },
            run: { img: "./static/img/tylerRun.png", frames_max: 4 },
            return: { img: "./static/img/tylerReturn.png", frames_max: 4 },
            hit: { img: "./static/img/tylerHit.png", frames_max: 2 },
            kick: { img: "./static/img/tylerCombo.png", frames_max: 2 },
            jump: { img: "./static/img/tylerJump.png", frames_max: 2 },
            getHit: { img: "./static/img/tylergetHit.png", frames_max: 3 },
        },
    });

    player_two.facing = -1;
}
