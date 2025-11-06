import express from "express";
import { handler } from "./index.mjs";

const app = express();
app.use(express.json());

// Simulate API Gateway event structure
const createEvent = (method, path, body, pathParams) => ({
  requestContext: { http: { method } },
  routeKey: `${method} ${path}`,
  body: body ? JSON.stringify(body) : null,
  pathParameters: pathParams || {},
});

app.get("/paticpant/:exchangeId", async (req, res) => {
  const event = createEvent("GET", "/paticpant/{exchangeId}", null, null);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.post("/paticpant/pair", async (req, res) => {
  const event = createEvent("POST", "/paticpant/pair", req.body);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get("/paticpant/pairs/:exchangeId", async (req, res) => {
  const event = createEvent("GET", "/paticpant/pairs/{exchangeId}", null, { name: req.params.exchangeId });
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.delete("/paticpant/pair/:id", async (req, res) => {
  const event = createEvent("DELETE", "/paticpant/pair/{id}", null, { id: req.params.id });
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get("/paticpant/shuffle", async (req, res) => {
  const event = createEvent("GET", "/paticpant/shuffle", null, null);
  const result = await handler(event);
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));