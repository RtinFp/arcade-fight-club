import { setMatchResult, matchResult } from "./core.js";

let resultSent = false;

function isPlaceholderName(name) {
    return (
        !name ||
        name === "Waiting..." ||
        name === "Host" ||
        name === "Opponent" ||
        name === "You" ||
        name === "BOT"
    );
}

// Writes the local matchResult and optionally posts once to /result.
export async function reportMatchResult(winner, loser, { record = true } = {}) {
    setMatchResult(winner, loser);
    if (!record || resultSent) return;
    if (isPlaceholderName(winner) || isPlaceholderName(loser) || winner === loser) return;

    resultSent = true;
    try {
        const res = await fetch("/result", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ winner, loser }),
        });
        if (!res.ok) resultSent = false;
    } catch (_) {
        resultSent = false;
    }
}

export function getMatchResult() {
    return matchResult;
}
