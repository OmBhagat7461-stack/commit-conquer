/**
 * packages/server/services/order-service.ts
 *
 * Standalone entrypoint for the Order Service.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "../../core/logger";
import { OrderService } from "../../modules/orders/order.service";
import { ServiceError } from "../../modules/products/product.service";

const app = express();
const PORT = parseInt(process.env.ORDER_SERVICE_PORT ?? "4004", 10);

app.use(helmet());
app.use(cors());
app.use(express.json());

function handleErr(e: unknown, res: express.Response) {
  if (e instanceof ServiceError) {
    const codeMap: Record<string, number> = {
      ORDER_NOT_FOUND: 404, INVALID_TRANSITION: 422,
    };
    res.status(codeMap[e.code] ?? 400).json({ error: { code: e.code, message: e.message } });
    return;
  }
  logger.error("order-service error", { error: e instanceof Error ? e.message : String(e) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
}

app.get("/health", (_req, res) => {
  res.json({ service: "order-service", status: "ok", uptime: process.uptime() });
});

app.get("/orders", (req, res) => {
  try {
    const result = OrderService.list({
      offset: parseInt(String(req.query.offset ?? "0"), 10),
      limit:  parseInt(String(req.query.limit  ?? "20"), 10),
      status: (req.query.status as any) ?? "all",
      search: req.query.search as string,
      sort:   (req.query.sort as any) ?? "newest",
    });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.get("/orders/:id", (req, res) => {
  try {
    const order = OrderService.getById(req.params.id);
    res.json({ order });
  } catch (e) { handleErr(e, res); }
});

app.post("/orders", async (req, res) => {
  try {
    const order = await OrderService.place(req.body);
    res.status(201).json({ order });
  } catch (e) { handleErr(e, res); }
});

app.post("/orders/:id/fulfill", async (req, res) => {
  try {
    const order = await OrderService.fulfill(req.params.id);
    res.json({ order });
  } catch (e) { handleErr(e, res); }
});

app.post("/orders/:id/cancel", async (req, res) => {
  try {
    const order = await OrderService.cancel(req.params.id);
    res.json({ order });
  } catch (e) { handleErr(e, res); }
});

app.listen(PORT, () => {
  logger.info("Order Service started", { port: PORT });
});

export default app;
