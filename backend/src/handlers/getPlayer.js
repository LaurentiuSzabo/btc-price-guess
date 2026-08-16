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

  try {
    const { player, price, resolution } = await gameService.getState(playerId);
    const body = serializePlayerState(player, price, resolution);

    // Only worth telling WS subscribers when this GET actually changed
    // something (a lazy resolution) — a plain read isn't news to anyone.
    if (resolution) {
      await broadcastToPlayer(playerId, body).catch((err) => console.error('broadcast failed', err));
    }

    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'INTERNAL_ERROR' }) };
  }
};
