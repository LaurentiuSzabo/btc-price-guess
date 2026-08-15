const RESOLVE_DELAY_MS = 60_000;
const MAX_HISTORY = 10;

function createNewPlayer(playerId) {
  return { playerId, score: 0, guess: null, history: [], streak: 0, wins: 0, totalPlayed: 0 };
}

function canGuess(player) {
  return player.guess === null || player.guess === undefined;
}

function placeGuess(player, direction, price, now) {
  if (!canGuess(player)) {
    throw new Error('GUESS_IN_PROGRESS');
  }
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('INVALID_DIRECTION');
  }
  return {
    ...player,
    guess: {
      guessId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      direction,
      entryPrice: price,
      placedAt: now,
    },
  };
}

// Resolves a pending guess if the price has moved and >=60s have elapsed.
// Returns { player, resolution } where resolution is null if nothing changed.
function tryResolve(player, currentPrice, now) {
  const guess = player.guess;
  if (!guess) return { player, resolution: null };

  const elapsed = now - guess.placedAt;
  const priceChanged = currentPrice !== guess.entryPrice;

  if (elapsed < RESOLVE_DELAY_MS || !priceChanged) {
    return { player, resolution: null };
  }

  const wentUp = currentPrice > guess.entryPrice;
  const correct = guess.direction === 'up' ? wentUp : !wentUp;
  const delta = correct ? 1 : -1;

  const resolution = {
    guessId: guess.guessId,
    correct,
    delta,
    direction: guess.direction,
    entryPrice: guess.entryPrice,
    exitPrice: currentPrice,
    resolvedAt: now,
  };

  return {
    player: {
      ...player,
      score: player.score + delta,
      guess: null,
      history: [resolution, ...(player.history ?? [])].slice(0, MAX_HISTORY),
      streak: correct ? (player.streak ?? 0) + 1 : 0,
      wins: (player.wins ?? 0) + (correct ? 1 : 0),
      totalPlayed: (player.totalPlayed ?? 0) + 1,
    },
    resolution,
  };
}

module.exports = {
  RESOLVE_DELAY_MS,
  MAX_HISTORY,
  createNewPlayer,
  canGuess,
  placeGuess,
  tryResolve,
};
