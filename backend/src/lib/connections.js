const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.CONNECTIONS_TABLE;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Matches API Gateway's own 2-hour max WebSocket connection lifetime — any
// connection record left behind by a missed $disconnect expires on its own.
const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

async function saveConnection(connectionId, playerId) {
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        connectionId,
        playerId,
        expiresAt: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
      },
    })
  );
}

async function deleteConnection(connectionId) {
  await client.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { connectionId } }));
}

async function getConnectionsForPlayer(playerId) {
  const { Items } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'PlayerIndex',
      KeyConditionExpression: 'playerId = :playerId',
      ExpressionAttributeValues: { ':playerId': playerId },
    })
  );
  return (Items || []).map((item) => item.connectionId);
}

module.exports = { saveConnection, deleteConnection, getConnectionsForPlayer };
