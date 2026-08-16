// Shared response shape for HTTP and WebSocket handlers alike.
function serializePlayerState(player, price, resolution) {
  return {
    playerId: player.playerId,
    score: player.score,
    guess: player.guess,
    history: player.history ?? [],
    streak: player.streak ?? 0,
    wins: player.wins ?? 0,
    totalPlayed: player.totalPlayed ?? 0,
    price,
    resolution,
  };
}

module.exports = { serializePlayerState };
