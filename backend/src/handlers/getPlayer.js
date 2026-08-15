const gameService = require('../lib/gameService');

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
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        playerId: player.playerId,
        score: player.score,
        guess: player.guess,
        history: player.history ?? [],
        streak: player.streak ?? 0,
        wins: player.wins ?? 0,
        totalPlayed: player.totalPlayed ?? 0,
        price,
        resolution,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'INTERNAL_ERROR' }) };
  }
};
