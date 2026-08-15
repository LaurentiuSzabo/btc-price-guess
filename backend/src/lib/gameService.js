const store = require('./store');
const { getBtcPrice } = require('./price');
const gameLogic = require('./gameLogic');

async function getOrCreatePlayer(playerId) {
  let player = await store.getPlayer(playerId);
  if (!player) {
    const fresh = gameLogic.createNewPlayer(playerId);
    await store.createPlayerIfAbsent(fresh);
    player = await store.getPlayer(playerId);
  }
  return player;
}

// Resolves a pending guess if eligible. Returns { player, resolution }.
async function resolveIfNeeded(player, currentPrice, now) {
  const { player: updated, resolution } = gameLogic.tryResolve(player, currentPrice, now);
  if (resolution) {
    await store.savePlayerAfterResolve(updated, resolution.guessId);
  }
  return { player: updated, resolution };
}

// GET /players/{playerId}: fetch-or-create, lazily resolve, return state + price.
async function getState(playerId) {
  const player = await getOrCreatePlayer(playerId);
  const price = await getBtcPrice();
  const now = Date.now();
  try {
    const { player: updated, resolution } = await resolveIfNeeded(player, price, now);
    return { player: updated, price, resolution };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      // Someone else resolved it concurrently — read the latest state.
      const latest = await store.getPlayer(playerId);
      return { player: latest, price, resolution: null };
    }
    throw err;
  }
}

// POST /players/{playerId}/guess. Returns { player, price, resolution } —
// resolution is only set if placing this guess also resolved a stale one.
async function placeGuess(playerId, direction) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let player = await getOrCreatePlayer(playerId);
    const price = await getBtcPrice();
    const now = Date.now();

    // Resolve any stale pending guess first so a fresh one can be placed.
    const { player: afterResolve, resolution } = await resolveIfNeeded(player, price, now).catch(
      (err) => {
        if (err.name === 'ConditionalCheckFailedException') return { player, resolution: null };
        throw err;
      }
    );

    if (!gameLogic.canGuess(afterResolve)) {
      const err = new Error('GUESS_IN_PROGRESS');
      err.statusCode = 409;
      throw err;
    }

    const updated = gameLogic.placeGuess(afterResolve, direction, price, now);
    try {
      await store.savePlayerIfNoGuess(updated);
      return { player: updated, price, resolution };
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        lastErr = err;
        continue; // someone else placed/resolved a guess concurrently — retry
      }
      throw err;
    }
  }
  const err = new Error('GUESS_IN_PROGRESS');
  err.statusCode = 409;
  err.cause = lastErr;
  throw err;
}

// POST /players/{playerId}/reset — clears score/streak/history but leaves a
// pending guess (if any) untouched, so an in-flight round still resolves fairly.
async function resetPlayer(playerId) {
  const player = await getOrCreatePlayer(playerId);
  const cleared = {
    ...player,
    score: 0,
    streak: 0,
    wins: 0,
    totalPlayed: 0,
    history: [],
  };
  await store.savePlayer(cleared);
  return cleared;
}

module.exports = { getState, placeGuess, resetPlayer };
