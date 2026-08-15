const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.PLAYERS_TABLE;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function getPlayer(playerId) {
  const { Item } = await client.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { playerId } })
  );
  return Item || null;
}

// Creates a brand new player row, but only if one doesn't already exist
// (avoids clobbering a concurrent first request for the same new playerId).
async function createPlayerIfAbsent(player) {
  try {
    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: player,
        ConditionExpression: 'attribute_not_exists(playerId)',
      })
    );
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

// Persists a player whose `guess` was null (no active guess) — used when
// placing a new guess. Fails if another request placed a guess first.
async function savePlayerIfNoGuess(player) {
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: player,
      ConditionExpression: 'guess = :null',
      ExpressionAttributeValues: { ':null': null },
    })
  );
}

// Persists a player after resolving a specific guess — used when clearing
// a pending guess. Fails if that guess was already resolved elsewhere.
async function savePlayerAfterResolve(player, resolvedGuessId) {
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: player,
      ConditionExpression: 'guess.guessId = :gid',
      ExpressionAttributeValues: { ':gid': resolvedGuessId },
    })
  );
}

// Unconditional overwrite — used for the "clear my history" reset action,
// where last-write-wins is an acceptable tradeoff for a low-stakes UI action.
async function savePlayer(player) {
  await client.send(new PutCommand({ TableName: TABLE_NAME, Item: player }));
}

module.exports = {
  getPlayer,
  createPlayerIfAbsent,
  savePlayerIfNoGuess,
  savePlayerAfterResolve,
  savePlayer,
};
