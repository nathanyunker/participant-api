import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

// Utility function to convert DynamoDB item to plain JSON
const unmarshallItem = (item) => {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S) result[key] = value.S; // Handle string values
    if (value.L) result[key] = value.L.map((v) => v.S); // Handle list of strings
  }
  return result;
};

function randomizeParticipants(participants, previousPairs = []) {
    // Sort participants by ageOrder ascending
    const sortedParticipants = [...participants].sort((a, b) => a.ageOrder - b.ageOrder);
    const available = [...participants]; // Copy for recipient selection
    const pairs = [];

    // Shuffle helper (Fisher-Yates)
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // Check if a gifter-recipient pair is valid
    function isValidPair(gifter, recipient, existingPairs) {
        // Basic checks: no self-pairing and respects noMatch
        if (
            gifter.name === recipient.name || // No self-pairing
            gifter.noMatch.includes(recipient.name) || // Gifter excludes recipient
            recipient.noMatch.includes(gifter.name) // Recipient excludes gifter
        ) {
            return false;
        }

        // Check for reciprocal pair (e.g., gifter → recipient and recipient → gifter)
        for (const pair of existingPairs) {
            if (pair.gifter === recipient.name && pair.recipient === gifter.name) {
                return false; // Reciprocal pair found
            }
        }

        // Check against previousPairs for repeats
        for (const prevPair of previousPairs) {
            if (prevPair.gifter === gifter.name && prevPair.recipient === recipient.name) {
                return false; // Repeat pair found
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

async function fetchPaticipantGiftExchangeParticipants() {
    const client = new DynamoDBClient({ region: "us-east-1" }); // Replace with your region

    const params = {
        TableName: "SiblingsGiftExchange",
        IndexName: "gsipk-gsisk-index",
        KeyConditionExpression: "#pk = :pkVal AND begins_with(#sk, :skVal)",
        ExpressionAttributeNames: {
            "#pk": "gsipk",
            "#sk": "gsisk"
        },
        ExpressionAttributeValues: {
            ":pkVal": { S: "participant" }, // Exact match for GSI partition key
            ":skVal": { S: "participant" }  // Filter GSI sort key starting with "participant"
        }
    };

    try {
        let items = [];
        let lastEvaluatedKey = null;
        do {
            const command = new QueryCommand({
                ...params,
                ExclusiveStartKey: lastEvaluatedKey
            });
            const response = await client.send(command);

            items = items.concat(response.Items.map(item => unmarshall(item)));
            lastEvaluatedKey = response.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        return items;
    } catch (error) {
        // Handle errors and return an error response
        console.error("Error retrieving items from DynamoDB:", error);
        throw new Error(`Error retrieving items from DynamoDB: ${error.message}`);
    }
}

async function fetchParticipantsGiftExchangePreviousPairs(year) {
    const client = new DynamoDBClient({ region: "us-east-1" });

    const params = {
        TableName: "SiblingsGiftExchange",
        KeyConditionExpression: "#pk = :pkVal",
        ExpressionAttributeNames: {
            "#pk": "id"
        },
        ExpressionAttributeValues: {
            ":pkVal": { S: `previous#${year}` }
        }
    };

    try {
        const command = new QueryCommand(params);
        const response = await client.send(command);

        const items = response.Items.map(item => unmarshall(item));
        if (items.length === 0) {
            console.log(`No item found for partition key: previous#${year}`);
            return null;
        }
        return items[0];
    } catch (error) {
        // Handle errors and return an error response
        console.error("Error retrieving item from DynamoDB:", error);
        throw new Error(`Error retrieving item from DynamoDB: ${error.message}`);
    }
}

async function getRandomParticipantPair() {
    try {
        console.log('---ABOUT TO FETCH---------');
        const particpantsList = await fetchParticipantsGiftExchangeParticipants();
        const lastYear = String(new Date().getFullYear() - 1);
        const previousPairs = await fetchParticipantsGiftExchangePreviousPairs(lastYear);
        console.log('---- FETCHed---------', particpantsList);
        console.log('---- previous---------', previousPairs);

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
  const client = new DynamoDBClient({ region: 'us-east-1' });

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
        'Access-Control-Allow-Origin': '*', // Enable CORS if needed
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

// Main Lambda handler with route dispatching
export const handler = async (event) => {
    console.log('----------this was hit-----------', event.routeKey);
    try {
    const routeKey = event.routeKey;

    const routes = {
        "GET /participant/shuffle": getRandomParticipantPair,
        "GET /participants": getParticipants
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