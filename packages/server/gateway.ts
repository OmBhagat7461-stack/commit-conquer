/**
 * packages/server/gateway.ts
 *
 * API Gateway — a thin reverse-proxy layer that routes incoming requests
 * to the correct microservice.  Each service can be scaled independently
 * by running it as a separate Docker container.
 *
 * Architecture:
 *   Client → Gateway (:4000)
 *            ├── /api/store/products/**  → Product Service (:4001)
 *            ├── /api/store/auth/**      → Auth Service    (:4002)
 *            ├── /api/store/carts/**     → Cart Service    (:4003)
 *            ├── /api/store/orders/**    → Order Service   (:4004)
 *            ├── /api/admin/**           → Admin Service   (:4005)
 *            └── /health                 → local
 *
 * In development, all services run in-process (single binary).
 * In production, set SERVICE_MODE=gateway to proxy to separate containers.
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "../core/logger";

const app = express();
const PORT = parseInt(process.env.GATEWAY_PORT ?? process.env.PORT ?? "4000", 10);

app.use(helmet());
app.use(cors({
  origin:      process.env.CORS_ORIGIN ?? "http://localhost:5173",
  credentials: true,
  methods:     ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Secret", "X-Cart-Id"],
}));
app.use(express.json({ limit: "2mb" }));

// ─── Service Registry ─────────────────────────────────────────────────────────
// In production, these point to separate containers.
// In development, they all point to the monolith on the same port.

export interface ServiceEndpoint {
  name: string;
  url: string;
  healthPath: string;
}

const SERVICE_MODE = process.env.SERVICE_MODE ?? "monolith"; // "monolith" | "gateway"

export const SERVICES: Record<string, ServiceEndpoint> = {
  products: {
    name: "product-service",
    url: process.env.PRODUCT_SERVICE_URL ?? "http://localhost:4001",
    healthPath: "/health",
  },
  auth: {
    name: "auth-service",
    url: process.env.AUTH_SERVICE_URL ?? "http://localhost:4002",
    healthPath: "/health",
  },
  cart: {
    name: "cart-service",
    url: process.env.CART_SERVICE_URL ?? "http://localhost:4003",
    healthPath: "/health",
  },
  orders: {
    name: "order-service",
    url: process.env.ORDER_SERVICE_URL ?? "http://localhost:4004",
    healthPath: "/health",
  },
  admin: {
    name: "admin-service",
    url: process.env.ADMIN_SERVICE_URL ?? "http://localhost:4005",
    healthPath: "/health",
  },
};

// ─── Proxy Helper ─────────────────────────────────────────────────────────────

async function proxyRequest(
  serviceKey: string,
  path: string,
  req: Request,
  res: Response,
): Promise<void> {
  const service = SERVICES[serviceKey];
  if (!service) {
    res.status(502).json({ error: { code: "SERVICE_NOT_FOUND", message: `Unknown service: ${serviceKey}` } });
    return;
  }

  const targetUrl = `${service.url}${path}`;
  const headers: Record<string, string> = {};

  // Forward relevant headers
  if (req.headers.authorization) headers["authorization"] = req.headers.authorization as string;
  if (req.headers["x-admin-secret"]) headers["x-admin-secret"] = req.headers["x-admin-secret"] as string;
  if (req.headers["x-cart-id"]) headers["x-cart-id"] = req.headers["x-cart-id"] as string;
  headers["content-type"] = "application/json";
  headers["x-forwarded-for"] = req.ip ?? "unknown";
  headers["x-request-id"] = `gw_${Date.now()}`;

  try {
    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };

    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const body = await upstream.text();

    // Forward status + body
    res.status(upstream.status);
    for (const [key, val] of upstream.headers.entries()) {
      if (!["transfer-encoding", "connection", "content-encoding"].includes(key)) {
        res.set(key, val);
      }
    }
    res.send(body);
  } catch (err) {
    logger.error(`Gateway proxy error → ${service.name}`, {
      service: serviceKey,
      targetUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: `${service.name} is not reachable`,
      },
    });
  }
}

// ─── Gateway Health ───────────────────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const serviceHealth: Record<string, string> = {};

  if (SERVICE_MODE === "gateway") {
    // Check each upstream service
    const checks = Object.entries(SERVICES).map(async ([key, svc]) => {
      try {
        const r = await fetch(`${svc.url}${svc.healthPath}`, { signal: AbortSignal.timeout(2000) });
        serviceHealth[key] = r.ok ? "healthy" : "degraded";
      } catch {
        serviceHealth[key] = "unreachable";
      }
    });
    await Promise.all(checks);
  }

  res.json({
    status: "ok",
    mode: SERVICE_MODE,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: SERVICE_MODE === "gateway" ? serviceHealth : "in-process",
  });
});

// ─── Route Dispatch ───────────────────────────────────────────────────────────

if (SERVICE_MODE === "gateway") {
  // ── Gateway mode: proxy to separate service containers ─────────────────

  // Product routes
  app.all("/api/store/products/*", (req, res) => {
    const path = req.originalUrl.replace("/api/store/products", "/products");
    proxyRequest("products", path, req, res);
  });
  app.all("/api/store/categories*", (req, res) => {
    proxyRequest("products", req.originalUrl.replace("/api/store", ""), req, res);
  });

  // Auth routes
  app.all("/api/store/auth/*", (req, res) => {
    const path = req.originalUrl.replace("/api/store/auth", "/auth");
    proxyRequest("auth", path, req, res);
  });

  // Cart routes
  app.all("/api/store/carts/*", (req, res) => {
    const path = req.originalUrl.replace("/api/store/carts", "/carts");
    proxyRequest("cart", path, req, res);
  });
  app.all("/api/store/carts", (req, res) => {
    proxyRequest("cart", "/carts", req, res);
  });

  // Order routes
  app.all("/api/store/orders/*", (req, res) => {
    const path = req.originalUrl.replace("/api/store/orders", "/orders");
    proxyRequest("orders", path, req, res);
  });

  // Admin routes
  app.all("/api/admin/*", (req, res) => {
    const path = req.originalUrl.replace("/api/admin", "/admin");
    proxyRequest("admin", path, req, res);
  });

  logger.info("Gateway mode: proxying to upstream services", {
    services: Object.fromEntries(
      Object.entries(SERVICES).map(([k, v]) => [k, v.url]),
    ),
  });

} else {
  // ── Monolith mode: import everything in-process (default for dev) ──────
  // Just re-export the existing monolith server
  logger.info("Monolith mode: all services in-process");

  // Dynamically import the existing monolith entrypoint
  import("./index").then((mod) => {
    // The existing index.ts already mounts on the same express app
    // In monolith mode the gateway is not used — just start index.ts directly
  });
}

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (SERVICE_MODE === "gateway") {
  app.listen(PORT, () => {
    logger.info("API Gateway started", {
      port: PORT,
      mode: SERVICE_MODE,
    });
  });
}

export default app;
export { SERVICE_MODE };
