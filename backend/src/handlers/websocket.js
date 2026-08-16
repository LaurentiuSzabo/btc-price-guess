const gameService = require('../lib/gameService');
const { saveConnection, deleteConnection } = require('../lib/connections');
const { broadcastToPlayer } = require('../lib/broadcast');
const { serializePlayerState } = require('../lib/serialize');

exports.handler = async (event) => {
  const routeKey = event.requestContext.routeKey;
  const connectionId = event.requestContext.connectionId;

  try {
    switch (routeKey) {
      case '$connect':
        return { statusCode: 200 };

      case '$disconnect':
        await deleteConnection(connectionId);
        return { statusCode: 200 };

      case 'subscribe': {
        const playerId = parsePlayerId(event.body);
        if (!playerId) return { statusCode: 400, body: 'playerId required' };
        await saveConnection(connectionId, playerId);
        const { player, price, resolution } = await gameService.getState(playerId);
        await broadcastToPlayer(playerId, serializePlayerState(player, price, resolution));
        return { statusCode: 200 };
      }

      case 'tick': {
        const playerId = parsePlayerId(event.body);
        if (!playerId) return { statusCode: 400, body: 'playerId required' };
        const { player, price, resolution } = await gameService.getState(playerId);
        await broadcastToPlayer(playerId, serializePlayerState(player, price, resolution));
        return { statusCode: 200 };
      }

      default:
        return { statusCode: 400, body: 'Unknown route' };
    }
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Internal error' };
  }
};

function parsePlayerId(rawBody) {
  try {
    return JSON.parse(rawBody || '{}').playerId || null;
  } catch {
    return null;
  }
}
