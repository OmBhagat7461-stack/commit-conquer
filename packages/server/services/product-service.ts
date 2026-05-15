/**
 * packages/server/services/product-service.ts
 *
 * Standalone entrypoint for the Product Service.
 * Can be run as its own process/container for independent scaling.
 *
 *   SERVICE=products ts-node packages/server/services/product-service.ts
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "../../core/logger";
import { ProductService, ServiceError } from "../../modules/products/product.service";

const app = express();
const PORT = parseInt(process.env.PRODUCT_SERVICE_PORT ?? "4001", 10);

app.use(helmet());
app.use(cors());
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    service: "product-service",
    status: "ok",
    uptime: process.uptime(),
    cache: ProductService.cacheStats(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

function handleErr(e: unknown, res: express.Response) {
  if (e instanceof ServiceError) {
    const status = e.code.includes("NOT_FOUND") ? 404 : 400;
    res.status(status).json({ error: { code: e.code, message: e.message } });
    return;
  }
  logger.error("product-service error", { error: e instanceof Error ? e.message : String(e) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
}

app.get("/products", (req, res) => {
  try {
    const result = ProductService.list({
      offset:   parseInt(String(req.query.offset ?? "0"), 10),
      limit:    parseInt(String(req.query.limit  ?? "12"), 10),
      status:   (req.query.status as "published") ?? "published",
      category: req.query.category as string,
      search:   req.query.search   as string,
      sort:     req.query.sort     as "newest" | "price_asc" | "price_desc",
    });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.get("/products/:id", (req, res) => {
  try {
    const product = ProductService.getById(req.params.id);
    res.json({ product });
  } catch (e) { handleErr(e, res); }
});

app.get("/products/handle/:handle", (req, res) => {
  try {
    const product = ProductService.getByHandle(req.params.handle);
    res.json({ product });
  } catch (e) { handleErr(e, res); }
});

app.get("/categories", (_req, res) => {
  try {
    res.json({ categories: ProductService.categories() });
  } catch (e) { handleErr(e, res); }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info("Product Service started", { port: PORT });
});

export default app;
