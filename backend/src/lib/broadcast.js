const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');
const { getConnectionsForPlayer, deleteConnection } = require('./connections');

let client;
function getClient() {
  if (!client) {
    client = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_ENDPOINT });
  }
  return client;
}

// Pushes `payload` to every WebSocket connection currently subscribed to
// `playerId`. Connections the client dropped without a clean $disconnect
// (crashed tab, network loss) come back as GoneException — we just clean
// those up rather than treat them as errors.
async function broadcastToPlayer(playerId, payload) {
  if (!process.env.WEBSOCKET_ENDPOINT) return;
  const connectionIds = await getConnectionsForPlayer(playerId);
  if (connectionIds.length === 0) return;

  const data = Buffer.from(JSON.stringify(payload));
  await Promise.all(
    connectionIds.map(async (connectionId) => {
      try {
        await getClient().send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (err) {
        if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
          await deleteConnection(connectionId).catch(() => {});
        } else {
          console.error('broadcast failed', connectionId, err);
        }
      }
    })
  );
}

module.exports = { broadcastToPlayer };
