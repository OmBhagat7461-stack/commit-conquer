/**
 * packages/server/services/auth-service.ts
 *
 * Standalone entrypoint for the Auth Service.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "../../core/logger";
import { AuthService } from "../../modules/auth/auth.service";
import { ServiceError } from "../../modules/products/product.service";

const app = express();
const PORT = parseInt(process.env.AUTH_SERVICE_PORT ?? "4002", 10);

app.use(helmet());
app.use(cors());
app.use(express.json());

function handleErr(e: unknown, res: express.Response) {
  if (e instanceof ServiceError) {
    const codeMap: Record<string, number> = {
      INVALID_CREDENTIALS: 401, INVALID_TOKEN: 401, TOKEN_EXPIRED: 401,
      EMAIL_EXISTS: 409, VALIDATION_ERROR: 422, WEAK_PASSWORD: 422,
    };
    res.status(codeMap[e.code] ?? 400).json({ error: { code: e.code, message: e.message } });
    return;
  }
  logger.error("auth-service error", { error: e instanceof Error ? e.message : String(e) });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
}

app.get("/health", (_req, res) => {
  res.json({ service: "auth-service", status: "ok", uptime: process.uptime() });
});

app.post("/auth/register", async (req, res) => {
  try {
    const result = await AuthService.register(req.body);
    res.status(201).json(result);
  } catch (e) { handleErr(e, res); }
});

app.post("/auth/login", async (req, res) => {
  try {
    const result = await AuthService.login(req.body.email, req.body.password);
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.post("/auth/google", async (req, res) => {
  try {
    const result = await AuthService.googleLogin(req.body.credential);
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const result = await AuthService.refreshSession(req.body.refresh_token);
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

app.listen(PORT, () => {
  logger.info("Auth Service started", { port: PORT });
});

export default app;
