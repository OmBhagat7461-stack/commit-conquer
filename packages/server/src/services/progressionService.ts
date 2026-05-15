/**
 * packages/server/src/services/progressionService.ts
 *
 * Progression system — turns raw commit points into levels, titles,
 * and milestones that give users a persistent sense of achievement.
 *
 * Level curve:  XP required = BASE_XP * level^EXPONENT
 *   Level 1 →    0 XP   (everyone starts here)
 *   Level 2 →  100 XP
 *   Level 3 →  244 XP
 *   Level 5 →  669 XP
 *   Level 10 → 2154 XP
 *   Level 20 → 6946 XP
 */

import { AppError } from '../middleware/errorHandler';

// ─── Level Curve ──────────────────────────────────────────────────────────────

const BASE_XP  = 100;
const EXPONENT = 1.35;

function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(BASE_XP * Math.pow(level - 1, EXPONENT));
}

function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) {
    level++;
  }
  return level;
}

// ─── Titles ───────────────────────────────────────────────────────────────────
// Unlocked at specific levels.  Each user holds the highest title they've reached.

interface TitleDefinition {
  minLevel: number;
  title: string;
  description: string;
}

const TITLES: TitleDefinition[] = [
  { minLevel: 1,  title: "Newcomer",          description: "Just getting started" },
  { minLevel: 3,  title: "Contributor",        description: "Making a difference" },
  { minLevel: 5,  title: "Builder",            description: "Shipping consistently" },
  { minLevel: 8,  title: "Craftsman",          description: "Honing the craft" },
  { minLevel: 12, title: "Architect",          description: "Designing systems" },
  { minLevel: 16, title: "Veteran",            description: "Battle-tested" },
  { minLevel: 20, title: "Master",             description: "Mastery through practice" },
  { minLevel: 25, title: "Legend",             description: "A living legend" },
  { minLevel: 30, title: "Mass Commiter 3000", description: "Unstoppable force" },
];

function titleForLevel(level: number): TitleDefinition {
  let best = TITLES[0];
  for (const t of TITLES) {
    if (level >= t.minLevel) best = t;
  }
  return best;
}

// ─── Milestones ───────────────────────────────────────────────────────────────
// One-time achievements based on commit count or point thresholds.

interface MilestoneDefinition {
  id: string;
  name: string;
  description: string;
  condition: (stats: UserProgression) => boolean;
}

const MILESTONES: MilestoneDefinition[] = [
  { id: "first_commit",     name: "First Blood",        description: "Submit your first commit",          condition: (s) => s.commitCount >= 1 },
  { id: "ten_commits",      name: "Getting Serious",     description: "Submit 10 commits",                condition: (s) => s.commitCount >= 10 },
  { id: "fifty_commits",    name: "Half Century",        description: "Submit 50 commits",                condition: (s) => s.commitCount >= 50 },
  { id: "hundred_commits",  name: "Centurion",           description: "Submit 100 commits",               condition: (s) => s.commitCount >= 100 },
  { id: "five_hundred_pts", name: "Point Hoarder",       description: "Earn 500 total points",            condition: (s) => s.totalXp >= 500 },
  { id: "thousand_pts",     name: "Grand Scorer",        description: "Earn 1,000 total points",          condition: (s) => s.totalXp >= 1000 },
  { id: "level_5",          name: "Rising Star",         description: "Reach level 5",                    condition: (s) => s.level >= 5 },
  { id: "level_10",         name: "Double Digits",       description: "Reach level 10",                   condition: (s) => s.level >= 10 },
  { id: "level_20",         name: "Elite",               description: "Reach level 20",                   condition: (s) => s.level >= 20 },
  { id: "streak_7",         name: "Week Warrior",        description: "Commit 7 days in a row",           condition: (s) => s.currentStreak >= 7 },
  { id: "streak_30",        name: "Monthly Machine",     description: "Commit 30 days in a row",          condition: (s) => s.currentStreak >= 30 },
];

// ─── User Progression State ──────────────────────────────────────────────────

export interface UserProgression {
  userId: string;
  totalXp: number;
  level: number;
  xpInCurrentLevel: number;
  xpToNextLevel: number;
  title: string;
  titleDescription: string;
  commitCount: number;
  currentStreak: number;       // consecutive days with commits
  longestStreak: number;
  lastCommitDate: string | null;
  unlockedMilestones: string[];   // milestone IDs
  newMilestones: string[];        // just-unlocked (cleared on next read)
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────

interface ProgressionRecord {
  userId: string;
  totalXp: number;
  commitCount: number;
  currentStreak: number;
  longestStreak: number;
  lastCommitDate: string | null;  // ISO date string (YYYY-MM-DD)
  unlockedMilestones: Set<string>;
  pendingMilestones: string[];    // announced once then cleared
}

const progressionStore = new Map<string, ProgressionRecord>();

function _getOrCreate(userId: string): ProgressionRecord {
  let rec = progressionStore.get(userId);
  if (!rec) {
    rec = {
      userId,
      totalXp: 0,
      commitCount: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastCommitDate: null,
      unlockedMilestones: new Set(),
      pendingMilestones: [],
    };
    progressionStore.set(userId, rec);
  }
  return rec;
}

function _toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function _daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / msPerDay,
  );
}

function _buildResponse(rec: ProgressionRecord): UserProgression {
  const level       = levelFromXp(rec.totalXp);
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp    = xpForLevel(level + 1);
  const titleDef       = titleForLevel(level);

  const response: UserProgression = {
    userId:           rec.userId,
    totalXp:          rec.totalXp,
    level,
    xpInCurrentLevel: rec.totalXp - currentLevelXp,
    xpToNextLevel:    nextLevelXp - currentLevelXp,
    title:            titleDef.title,
    titleDescription: titleDef.description,
    commitCount:      rec.commitCount,
    currentStreak:    rec.currentStreak,
    longestStreak:    rec.longestStreak,
    lastCommitDate:   rec.lastCommitDate,
    unlockedMilestones: [...rec.unlockedMilestones],
    newMilestones:    [...rec.pendingMilestones],
  };

  // Clear pending milestones after they've been read
  rec.pendingMilestones = [];

  return response;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ProgressionService {
  /** Test helper */
  _reset(): void {
    progressionStore.clear();
  }

  /**
   * Record XP earned from a commit.  Updates level, streak, and milestones.
   * Returns the full updated progression state including any newly unlocked
   * milestones.
   */
  async recordCommit(userId: string, points: number): Promise<UserProgression> {
    const rec = _getOrCreate(userId);
    const today = _toDateKey(new Date());

    // ── XP ────────────────────────────────────────────────────────────────
    const prevLevel = levelFromXp(rec.totalXp);
    rec.totalXp     += points;
    rec.commitCount += 1;

    // ── Streak ────────────────────────────────────────────────────────────
    if (rec.lastCommitDate) {
      const gap = _daysBetween(rec.lastCommitDate, today);
      if (gap === 1) {
        // Consecutive day
        rec.currentStreak += 1;
      } else if (gap > 1) {
        // Streak broken
        rec.currentStreak = 1;
      }
      // gap === 0 means same day — streak unchanged
    } else {
      rec.currentStreak = 1;
    }
    rec.longestStreak = Math.max(rec.longestStreak, rec.currentStreak);
    rec.lastCommitDate = today;

    // ── Level-up check ────────────────────────────────────────────────────
    const newLevel = levelFromXp(rec.totalXp);
    if (newLevel > prevLevel) {
      // Level-up happened — title may have changed too
    }

    // ── Milestone check ───────────────────────────────────────────────────
    const response = _buildResponse(rec); // need level computed
    for (const m of MILESTONES) {
      if (!rec.unlockedMilestones.has(m.id) && m.condition(response)) {
        rec.unlockedMilestones.add(m.id);
        rec.pendingMilestones.push(m.id);
      }
    }

    return _buildResponse(rec);
  }

  /** Get the current progression state for a user. */
  async getProgression(userId: string): Promise<UserProgression> {
    const rec = _getOrCreate(userId);
    return _buildResponse(rec);
  }

  /** Get all available milestones with unlock status for a user. */
  async getMilestones(userId: string): Promise<Array<{
    id: string;
    name: string;
    description: string;
    unlocked: boolean;
  }>> {
    const rec = _getOrCreate(userId);
    return MILESTONES.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      unlocked: rec.unlockedMilestones.has(m.id),
    }));
  }

  /** Return the level-up table (useful for UI progress bars). */
  getLevelTable(maxLevel = 30): Array<{ level: number; xpRequired: number; title: string }> {
    const table: Array<{ level: number; xpRequired: number; title: string }> = [];
    for (let i = 1; i <= maxLevel; i++) {
      table.push({
        level: i,
        xpRequired: xpForLevel(i),
        title: titleForLevel(i).title,
      });
    }
    return table;
  }
}
