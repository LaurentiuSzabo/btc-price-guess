const {
  RESOLVE_DELAY_MS,
  MAX_HISTORY,
  createNewPlayer,
  canGuess,
  placeGuess,
  tryResolve,
} = require('../src/lib/gameLogic');

describe('createNewPlayer', () => {
  test('starts with score 0, no guess, empty history, and zeroed stats', () => {
    const player = createNewPlayer('p1');
    expect(player).toEqual({
      playerId: 'p1',
      score: 0,
      guess: null,
      history: [],
      streak: 0,
      wins: 0,
      totalPlayed: 0,
    });
  });
});

describe('placeGuess', () => {
  test('records direction, entry price, and timestamp', () => {
    const player = createNewPlayer('p1');
    const updated = placeGuess(player, 'up', 100, 1_000);
    expect(updated.guess).toMatchObject({ direction: 'up', entryPrice: 100, placedAt: 1_000 });
    expect(updated.guess.guessId).toBeTruthy();
  });

  test('throws if a guess is already pending', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 1_000);
    expect(() => placeGuess(player, 'down', 105, 2_000)).toThrow('GUESS_IN_PROGRESS');
  });

  test('throws on an invalid direction', () => {
    expect(() => placeGuess(createNewPlayer('p1'), 'sideways', 100, 1_000)).toThrow(
      'INVALID_DIRECTION'
    );
  });

  test('canGuess is false while a guess is pending, true otherwise', () => {
    const fresh = createNewPlayer('p1');
    expect(canGuess(fresh)).toBe(true);
    const withGuess = placeGuess(fresh, 'up', 100, 1_000);
    expect(canGuess(withGuess)).toBe(false);
  });
});

describe('tryResolve', () => {
  test('does nothing when there is no pending guess', () => {
    const player = createNewPlayer('p1');
    const { player: updated, resolution } = tryResolve(player, 100, 5_000);
    expect(resolution).toBeNull();
    expect(updated).toBe(player);
  });

  test('does not resolve before 60s have elapsed, even if price moved', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { resolution } = tryResolve(player, 110, RESOLVE_DELAY_MS - 1);
    expect(resolution).toBeNull();
  });

  test('does not resolve after 60s if price has not changed', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { resolution } = tryResolve(player, 100, RESOLVE_DELAY_MS + 5_000);
    expect(resolution).toBeNull();
  });

  test('correct "up" guess: price rose after 60s -> +1 and guess cleared', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { player: updated, resolution } = tryResolve(player, 105, RESOLVE_DELAY_MS);
    expect(resolution).toMatchObject({ correct: true, delta: 1 });
    expect(updated.score).toBe(1);
    expect(updated.guess).toBeNull();
  });

  test('incorrect "up" guess: price fell after 60s -> -1', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { player: updated, resolution } = tryResolve(player, 95, RESOLVE_DELAY_MS);
    expect(resolution).toMatchObject({ correct: false, delta: -1 });
    expect(updated.score).toBe(-1);
  });

  test('correct "down" guess: price fell after 60s -> +1', () => {
    const player = placeGuess(createNewPlayer('p1'), 'down', 100, 0);
    const { player: updated, resolution } = tryResolve(player, 90, RESOLVE_DELAY_MS);
    expect(resolution).toMatchObject({ correct: true, delta: 1 });
    expect(updated.score).toBe(1);
  });

  test('incorrect "down" guess: price rose after 60s -> -1', () => {
    const player = placeGuess(createNewPlayer('p1'), 'down', 100, 0);
    const { player: updated, resolution } = tryResolve(player, 101, RESOLVE_DELAY_MS);
    expect(resolution).toMatchObject({ correct: false, delta: -1 });
    expect(updated.score).toBe(-1);
  });

  test('a resolved player can immediately guess again', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { player: resolved } = tryResolve(player, 105, RESOLVE_DELAY_MS);
    expect(canGuess(resolved)).toBe(true);
    const nextGuess = placeGuess(resolved, 'down', 105, RESOLVE_DELAY_MS);
    expect(nextGuess.guess.direction).toBe('down');
  });

  test('appends the resolution to history, most recent first', () => {
    const player = placeGuess(createNewPlayer('p1'), 'up', 100, 0);
    const { player: resolved } = tryResolve(player, 105, RESOLVE_DELAY_MS);
    expect(resolved.history).toHaveLength(1);
    expect(resolved.history[0]).toMatchObject({ correct: true, delta: 1 });

    const player2 = placeGuess(resolved, 'down', 105, RESOLVE_DELAY_MS);
    const { player: resolved2 } = tryResolve(player2, 110, RESOLVE_DELAY_MS * 2);
    expect(resolved2.history).toHaveLength(2);
    expect(resolved2.history[0]).toMatchObject({ correct: false, delta: -1 });
    expect(resolved2.history[1]).toMatchObject({ correct: true, delta: 1 });
  });

  test('caps history at MAX_HISTORY entries', () => {
    let player = createNewPlayer('p1');
    let price = 100;
    let now = 0;
    for (let i = 0; i < MAX_HISTORY + 3; i++) {
      player = placeGuess(player, 'up', price, now);
      price += 1;
      now += RESOLVE_DELAY_MS;
      ({ player } = tryResolve(player, price, now));
    }
    expect(player.history).toHaveLength(MAX_HISTORY);
  });

  test('streak increments on consecutive wins and resets to 0 on a loss', () => {
    let player = createNewPlayer('p1');
    player = placeGuess(player, 'up', 100, 0);
    ({ player } = tryResolve(player, 105, RESOLVE_DELAY_MS)); // win
    expect(player.streak).toBe(1);

    player = placeGuess(player, 'up', 105, RESOLVE_DELAY_MS);
    ({ player } = tryResolve(player, 110, RESOLVE_DELAY_MS * 2)); // win
    expect(player.streak).toBe(2);

    player = placeGuess(player, 'up', 110, RESOLVE_DELAY_MS * 2);
    ({ player } = tryResolve(player, 100, RESOLVE_DELAY_MS * 3)); // loss
    expect(player.streak).toBe(0);
  });

  test('wins and totalPlayed accumulate across resolutions', () => {
    let player = createNewPlayer('p1');
    player = placeGuess(player, 'up', 100, 0);
    ({ player } = tryResolve(player, 105, RESOLVE_DELAY_MS)); // win
    player = placeGuess(player, 'up', 105, RESOLVE_DELAY_MS);
    ({ player } = tryResolve(player, 95, RESOLVE_DELAY_MS * 2)); // loss

    expect(player.wins).toBe(1);
    expect(player.totalPlayed).toBe(2);
  });
});
