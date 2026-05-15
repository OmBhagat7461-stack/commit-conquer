/**
 * packages/server/src/app.ts
 */

import express, { Request, Response } from 'express';
import { UserService } from './services/userService';
import { CommitService } from './services/commitService';
import { LeaderboardService } from './services/leaderboardService';
import { ProgressionService } from './services/progressionService';
import { UserController } from './controllers/userController';
import { CommitController } from './controllers/commitController';
import { authenticate } from './middleware/authenticate';
import { validateBody } from './middleware/validateBody';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(express.json());

  const userService        = new UserService();
  const commitService      = new CommitService();
  const leaderboardService = new LeaderboardService();
  const progressionService = new ProgressionService();

  const userController   = new UserController(userService);
  const commitController = new CommitController(commitService, progressionService);

  // ── User routes ────────────────────────────────────────────────────────────
  app.get('/api/users', (req, res, next) =>
    userController.list(req, res, next));

  app.get('/api/users/:id', (req, res, next) =>
    userController.get(req, res, next));

  app.post('/api/auth/register',
    validateBody(['username', 'email']),
    (req, res, next) => userController.register(req, res, next),
  );

  app.post('/api/auth/login',
    validateBody(['email', 'password']),
    (req, res, next) => userController.login(req, res, next),
  );

  // ── Commit routes ──────────────────────────────────────────────────────────
  app.get('/api/commits', (req, res, next) =>
    commitController.list(req, res, next));

  app.get('/api/commits/:id', (req, res, next) =>
    commitController.get(req, res, next));

  app.post('/api/commits',
    authenticate,
    validateBody(['message', 'repo']),
    (req, res, next) => commitController.create(req, res, next),
  );

  app.delete('/api/commits/:id',
    authenticate,
    (req, res, next) => commitController.remove(req, res, next),
  );

  // ── Issue / PR linking routes ──────────────────────────────────────────────
  app.get('/api/issues/:ref/commits', async (req, res, next) => {
    try {
      const data = await commitService.findByIssue(req.params.ref);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/pr/commits', async (req, res, next) => {
    try {
      const prUrl = req.query.url as string;
      if (!prUrl) {
        return res.status(400).json({ success: false, error: 'url query param required' });
      }
      const data = await commitService.findByPr(prUrl);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });
  // ── Progression routes ─────────────────────────────────────────────────────
  app.get('/api/progression/levels', (_req, res) => {
    const table = progressionService.getLevelTable();
    res.json({ success: true, data: table });
  });

  app.get('/api/progression/:userId', async (req, res, next) => {
    try {
      const data = await progressionService.getProgression(req.params.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/progression/:userId/milestones', async (req, res, next) => {
    try {
      const data = await progressionService.getMilestones(req.params.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // ── Leaderboard routes ─────────────────────────────────────────────────────
  app.get('/api/leaderboard', async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
      const data  = await leaderboardService.getLeaderboard(limit);

      // Enrich leaderboard entries with progression data
      const enriched = await Promise.all(
        data.map(async (entry) => {
          const prog = await progressionService.getProgression(entry.userId);
          return {
            ...entry,
            level: prog.level,
            title: prog.title,
          };
        }),
      );

      res.json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/leaderboard/:userId', async (req, res, next) => {
    try {
      const data = await leaderboardService.getUserRank(req.params.userId);
      if (!data) {
        return res.status(404).json({ success: false, error: 'User not ranked' });
      }

      // Enrich with progression
      const prog = await progressionService.getProgression(req.params.userId);
      res.json({
        success: true,
        data: { ...data, level: prog.level, title: prog.title },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Error handler (must be last) ───────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
/**
 * packages/server/src/app.ts
 */

import express, { Request, Response } from 'express';
import { UserService } from './services/userService';
import { CommitService } from './services/commitService';
import { LeaderboardService } from './services/leaderboardService';
import { UserController } from './controllers/userController';
import { CommitController } from './controllers/commitController';
import { authenticate } from './middleware/authenticate';
import { validateBody } from './middleware/validateBody';
import { errorHandler } from './middleware/errorHandler';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();
  app.use(express.json());

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  app.use('/api/v1', apiLimiter);

  const userService       = new UserService();
  const commitService     = new CommitService();
  const leaderboardService = new LeaderboardService();

  const userController   = new UserController(userService);
  const commitController = new CommitController(commitService);

  // ── User routes ────────────────────────────────────────────────────────────
  app.get('/api/v1/users', (req, res, next) =>
    userController.list(req, res, next));

  app.get('/api/v1/users/:id', (req, res, next) =>
    userController.get(req, res, next));

  app.post('/api/v1/auth/register',
    validateBody(['username', 'email']),
    (req, res, next) => userController.register(req, res, next),
  );

  app.post('/api/v1/auth/login',
    validateBody(['email', 'password']),
    (req, res, next) => userController.login(req, res, next),
  );

  // ── Commit routes ──────────────────────────────────────────────────────────
  app.get('/api/v1/commits', (req, res, next) =>
    commitController.list(req, res, next));

  app.get('/api/v1/commits/:id', (req, res, next) =>
    commitController.get(req, res, next));

  app.post('/api/v1/commits',
    authenticate,
    validateBody(['message', 'repo']),
    (req, res, next) => commitController.create(req, res, next),
  );

  app.delete('/api/v1/commits/:id',
    authenticate,
    (req, res, next) => commitController.remove(req, res, next),
  );

  // ── Leaderboard routes ─────────────────────────────────────────────────────
  app.get('/api/v1/leaderboard', async (req, res, next) => {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
      const data  = await leaderboardService.getLeaderboard(limit);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/v1/leaderboard/:userId', async (req, res, next) => {
    try {
      const data = await leaderboardService.getUserRank(req.params.userId);
      if (!data) {
        return res.status(404).json({ success: false, error: 'User not ranked' });
      }
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Error handler (must be last) ───────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
