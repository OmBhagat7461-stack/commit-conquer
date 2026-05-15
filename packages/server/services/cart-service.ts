/**
 * packages/server/services/cart-service.ts
 *
 * Standalone entrypoint for the Cart Service.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "../../core/logger";
import { CartService } from "../../modules/cart/cart.service";
import { ServiceError } from "../../modules/products/product.service";

const app = express();
const PORT = parseInt(process.env.CART_SERVICE_PORT ?? "4003", 10);

app.use(helmet());
app.use(cors());
app.use(express.json());

function handleErr(e: unknown, res: express.Response) {
  if (e instanceof ServiceError) {
    const codeMap: Record<string, number> = {
      CART_NOT_FOUND: 404, ITEM_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404,
      EMPTY_CART: 422, MISSING_EMAIL: 422, MISSING_ADDRESS: 422,
      INSUFFICIENT_STOCK: 409,
    };
    res.status(codeMap[e.code] ?? 400).json({ error: { code: e.code, message: e.message } });
    return;
  }
  logger.error("cart-service error", { error: e instanceof Error ? e.message : String(e) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
}

app.get("/health", (_req, res) => {
  res.json({ service: "cart-service", status: "ok", uptime: process.uptime() });
});

app.post("/carts", async (req, res) => {
  try {
    const cart = await CartService.create(req.body.email);
    res.status(201).json({ cart });
  } catch (e) { handleErr(e, res); }
});

app.get("/carts/:id", (req, res) => {
  try {
    const cart = CartService.get(req.params.id);
    res.json({ cart });
  } catch (e) { handleErr(e, res); }
});

app.post("/carts/:id/items", async (req, res) => {
  try {
    const cart = await CartService.addItem(
      req.params.id, req.body.product_id, req.body.variant_id, req.body.quantity,
    );
    res.json({ cart });
  } catch (e) { handleErr(e, res); }
});

app.delete("/carts/:id/items/:itemId", async (req, res) => {
  try {
    const cart = await CartService.removeItem(req.params.id, req.params.itemId);
    res.json({ cart });
  } catch (e) { handleErr(e, res); }
});

app.post("/carts/:id/discount", async (req, res) => {
  try {
    const cart = await CartService.applyDiscount(req.params.id, req.body.code, req.body.customer_id);
    res.json({ cart });
  } catch (e) { handleErr(e, res); }
});

app.post("/carts/:id/complete", async (req, res) => {
  try {
    const result = await CartService.complete(req.params.id, req.body.customer_id);
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.listen(PORT, () => {
  logger.info("Cart Service started", { port: PORT });
});

export default app;
