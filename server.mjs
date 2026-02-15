import express from "express";
import { handler } from "./index.mjs";
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors()); 

// Simulate API Gateway event structure
const createEvent = (method, path, body, pathParams) => ({
  requestContext: { http: { method } },
  routeKey: `${method} ${path}`,
  body: body ? JSON.stringify(body) : null,
  pathParameters: pathParams || {},
});

app.get("/participant/shuffle", async (req, res) => {
  const event = createEvent("GET", "/participant/shuffle", null, null);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get("/participant/:exchangeId", async (req, res) => {
  const event = createEvent("GET", "/participant/{exchangeId}", null, null);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.post("/participant/exchange", async (req, res) => {
  const event = createEvent("POST", "/participant/exchange", req.body, null);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get("/participant/exchange/:exchangeId", async (req, res) => {
  const event = createEvent("GET", "/participant/exchange/{exchangeId}", null, { exchangeId: req.params.exchangeId });
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.delete("/participant/exchange/:exchangeId", async (req, res) => {
  const event = createEvent("DELETE", "/participant/exchange/{exchangeId}", null, { exchangeId: req.params.exchangeId });
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.listen(3001, () => console.log("Server running on http://localhost:3001"));