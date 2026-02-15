import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

const createResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  },
  body: JSON.stringify(body),
});

async function getParticipantExchange(event) {
  try {
    const year = event.pathParameters?.exchangeId;

    if (!year) {
      return createResponse(400, { status: "error", message: "Missing required path parameter: exchangeId" });
    }

    const pk = `exchange#${year}`;

    const params = {
      TableName: "SiblingsGiftExchange",
      KeyConditionExpression: "#pk = :pkVal",
      ExpressionAttributeNames: { "#pk": "id" },
      ExpressionAttributeValues: { ":pkVal": { S: pk } },
    };

    const command = new QueryCommand(params);
    const response = await client.send(command);

    if (!response.Items || response.Items.length === 0) {
      return createResponse(404, { status: "not_found", message: `No exchange data found for year ${year}` });
    }

    // Usually there should be only one item for this PK
    const item = unmarshall(response.Items[0]);

    // Parse the pairs string back to array
    if (item.pairs) {
      item.pairs = JSON.parse(item.pairs);
    }

    return createResponse(200, {
      status: "ok",
      year: item.year,
      pairs: item.pairs || [],
      createdAt: item.createdAt,
    });
  } catch (error) {
    console.error("Error fetching participant exchange:", error);
    return createResponse(500, { status: "error", message: error.message });
  }
}

async function deleteParticipantExchange(event) {
  try {
    const year = event.pathParameters?.exchangeId;

    if (!year) {
      return createResponse(400, { status: "error", message: "Missing required path parameter: exchangeId" });
    }

    const pk = `exchange#${year}`;

    const params = {
      TableName: "SiblingsGiftExchange",
      Key: {
        id: { S: pk },
      },
    };

    const command = new DeleteItemCommand(params);
    await client.send(command);

    return createResponse(200, {
      status: "ok",
      message: `Exchange data for year ${year} deleted successfully`,
    });
  } catch (error) {
    console.error("Error deleting participant exchange:", error);
    return createResponse(500, { status: "error", message: error.message });
  }
}

function randomizeParticipants(participants, previousPairs = []) {
  // Normalize `noMatch` entries and prepare participants
  function normalizeNoMatch(noMatch) {
      if (!noMatch) return [];
      if (typeof noMatch === 'string') return [noMatch];
      if (!Array.isArray(noMatch)) return [];
      return noMatch.flat(Infinity).map(String).filter(Boolean);
  }

  const normalizedParticipants = participants.map(p => ({
      ...p,
      noMatch: normalizeNoMatch(p.noMatch || []),
  }));

  const sortedParticipants = [...normalizedParticipants].sort((a, b) => a.ageOrder - b.ageOrder);
  const available = [...normalizedParticipants]; // Copy for recipient selection
  const pairs = [];

  function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
  }

  // Check if a gifter-recipient pair is valid
    function isValidPair(gifter, recipient, existingPairs) {
      if (gifter.name === recipient.name) return false;

      const gNoMatch = Array.isArray(gifter.noMatch) ? gifter.noMatch : [];
      const rNoMatch = Array.isArray(recipient.noMatch) ? recipient.noMatch : [];

      if (gNoMatch.includes(recipient.name) || rNoMatch.includes(gifter.name)) return false;

      // Check for reciprocal pair (e.g., gifter → recipient and recipient → gifter)
      for (const pair of existingPairs) {
          if (pair.gifter === recipient.name && pair.recipient === gifter.name) {
              return false;
          }
      }

        // Check against previousPairs for repeats
        for (const prevPair of previousPairs) {
          if (prevPair.gifter === gifter.name && prevPair.recipient === recipient.name) {
            return false;
          }
        }

      return true;
  }

  // Attempt to create a valid pairing with gifters sorted by ageOrder
  function tryPairing(currentIndex = 0, usedRecipients = new Set()) {
      if (currentIndex === sortedParticipants.length) {
          return true; // All paired successfully
      }

      const gifter = sortedParticipants[currentIndex]; // Gifter by ageOrder
      // Create a shuffled copy of available participants for random recipients
      const recipientPool = shuffle([...available]).filter(
          p => !usedRecipients.has(p.name) && p.name !== gifter.name
      );

      // Try each recipient from the shuffled pool
      for (const recipient of recipientPool) {
          if (isValidPair(gifter, recipient, pairs)) {
              // Tentatively assign this pair
              pairs.push({ gifter: gifter.name, recipient: recipient.name });
              usedRecipients.add(recipient.name);

              // Recursively try to pair the next gifter
              if (tryPairing(currentIndex + 1, usedRecipients)) {
                  return true;
              }

              // Backtrack: remove the pair and try the next recipient
              pairs.pop();
              usedRecipients.delete(recipient.name);
          }
      }

      return false; // No valid pairing found
  }

  // Validate input
  if (participants.length < 3) {
      throw new Error("At least 3 participants are required to avoid reciprocal pairs.");
  }

  // Try to create a complete pairing
  const usedRecipients = new Set();
  if (!tryPairing()) {
      throw new Error("No valid complete pairing possible with given constraints.");
  }

  return pairs;
}

async function fetchParticipantsGiftExchangeParticipants() {
  const params = {
    TableName: "SiblingsGiftExchange",
    IndexName: "gsipk-gsisk-index",
    KeyConditionExpression: "#pk = :pkVal AND begins_with(#sk, :skVal)",
    ExpressionAttributeNames: {
      "#pk": "gsipk",
      "#sk": "gsisk"
    },
    ExpressionAttributeValues: {
      ":pkVal": { S: "participant" },
      ":skVal": { S: "participant" }
    }
  };

  try {
    let items = [];
    let lastEvaluatedKey = undefined;

    do {
      const command = new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey
      });
      const response = await client.send(command);

      const pageItems = response.Items || [];

      if (pageItems.length < 1 ) {
        console.log('No Participants found')
      }

      items = items.concat(pageItems.map(unmarshall));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
  } catch (error) {
    console.error("Error fetching participants:", error);
    throw error;
  }
}

async function fetchParticipantsGiftExchangePreviousPairs(year) {
    const params = {
      TableName: "SiblingsGiftExchange",
      KeyConditionExpression: "#pk = :pkVal",
      ExpressionAttributeNames: { "#pk": "id" },
      ExpressionAttributeValues: { ":pkVal": { S: `previous#${year}` } }
    };

    try {
      const command = new QueryCommand(params);
      const response = await client.send(command);
      const pageItems = response.Items || [];

      if (pageItems.length < 1 ) {
        console.log('No Participants found')
      }
      const items = pageItems.map(unmarshall);

      return items.length > 0 ? items[0] : { pairs: [] };
    } catch (error) {
      console.error("Error fetching previous pairs:", error);
      throw error;
    }
}

async function getRandomParticipantPair() {
    try {
        const particpantsList = await fetchParticipantsGiftExchangeParticipants();
        const lastYear = String(new Date().getFullYear() - 1);
        const previousPairs = await fetchParticipantsGiftExchangePreviousPairs(lastYear);

        const result = randomizeParticipants(particpantsList, previousPairs.pairs);

        return {
            statusCode: 200,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "http://localhost:3000",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
            body: JSON.stringify(result)
        };
    } catch (error) {
        console.error(error.message);

        return {
            statusCode: 500,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "http://localhost:3000",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
            body: JSON.stringify({
                status: "error",
                message: "Failed to retrieve items from SiblingsGiftExchange",
                error: error.message
            })
        };
    }
}


const getParticipants = async (event) => {
  const params = {
    TableName: 'SiblingsGiftExchange',
    IndexName: 'gsipk-gsisk-index',
    KeyConditionExpression: '#pk = :pkVal AND begins_with(#sk, :skVal)',
    ExpressionAttributeNames: {
      '#pk': 'gsipk',
      '#sk': 'gsisk',
    },
    ExpressionAttributeValues: {
      ':pkVal': { S: 'participant' },
      ':skVal': { S: 'participant' },
    },
  };

  try {
    let items = [];
    let lastEvaluatedKey = null;

    // Paginate through results if necessary
    do {
      const command = new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      const response = await client.send(command);

      items = items.concat(response.Items.map(item => unmarshall(item)));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Transform items to return only the "Name" property
    const result = items.map(item => ({ Name: item.name }));

    // Return a successful API Gateway response
    return {
      statusCode: 200,
      body: JSON.stringify(result),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (error) {
    console.error('Error retrieving items from DynamoDB:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Error retrieving items: ${error.message}` }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
}

const setParticipantExchange = async (event) => {
  try {
    console.log('------------event=-------------------', JSON.stringify(event, null, 2))
    const body = event && event.body ? JSON.parse(event.body) : event;
    const year = body && (body.year || body.year === 0) ? String(body.year) : null;
    const pairs = body && body.pairs ? body.pairs : null;

    if (!year) {
      return createResponse(400, { status: 'error', message: "Missing required 'year' in request body" });
    }

    if (!pairs || !Array.isArray(pairs) || pairs.length < 1) {
      return createResponse(400, { status: 'error', message: "Missing or invalid 'pairs' array in request body" });
    }

    const pk = `exchange#${year}`;
    const gsipk = 'exchange';
    const gsisk = pk;

    const item = {
      id: { S: pk },
      gsipk: { S: gsipk },
      gsisk: { S: gsisk },
      year: { S: year },
      pairs: { S: JSON.stringify(pairs) },
      createdAt: { S: new Date().toISOString() }
    };

    const command = new PutItemCommand({
      TableName: 'SiblingsGiftExchange',
      Item: item
    });

    await client.send(command);

    return createResponse(201, { status: 'ok', message: 'Exchange saved', id: pk });
  } catch (error) {
    console.error('Error saving exchange:', error);
    return createResponse(500, { status: 'error', message: error.message });
  }
}

// ────────────────────────────────────────────────
//  Main Handler Function
// ────────────────────────────────────────────────
export const handler = async (event) => {
  console.log("----------this was hit-----------", event.routeKey);

  try {
    const routeKey = event.routeKey;

    const routes = {
      "GET /participant/shuffle": getRandomParticipantPair,
      "GET /participant": getParticipants,
      "POST /participant/exchange": setParticipantExchange,
      "GET /participant/exchange/{exchangeId}": getParticipantExchange,
      "DELETE /participant/exchange/{exchangeId}": deleteParticipantExchange,
    };

    const routeHandler = routes[routeKey];
    if (!routeHandler) {
      return createResponse(404, { message: "Route not found" });
    }

    return await routeHandler(event);
  } catch (error) {
    console.error("Error processing request:", error);
    return createResponse(500, { message: "Internal server error", error: error.message });
  }
};