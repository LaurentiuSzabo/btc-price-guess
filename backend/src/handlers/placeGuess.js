const gameService = require('../lib/gameService');
const { serializePlayerState } = require('../lib/serialize');
const { broadcastToPlayer } = require('../lib/broadcast');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  const playerId = event?.pathParameters?.playerId;
  if (!playerId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'MISSING_PLAYER_ID' }) };
  }

  let direction;
  try {
    const body = JSON.parse(event.body || '{}');
    direction = body.direction;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_BODY' }) };
  }

  if (direction !== 'up' && direction !== 'down') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'INVALID_DIRECTION' }) };
  }

  try {
    const { player, price, resolution } = await gameService.placeGuess(playerId, direction);
    const body = serializePlayerState(player, price, resolution);

    // Placing a guess always changes state — tell every other tab watching
    // this player right away instead of waiting for their next tick.
    await broadcastToPlayer(playerId, body).catch((err) => console.error('broadcast failed', err));

    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    if (err.statusCode === 409) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'GUESS_IN_PROGRESS' }) };
    }
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'INTERNAL_ERROR' }) };
  }
};
