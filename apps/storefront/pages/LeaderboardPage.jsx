/**
 * LeaderboardPage.jsx
 *
 * Leaderboard + Progression dashboard with celebration effects.
 * Detects rank changes, level-ups, and milestone unlocks — triggers
 * confetti, glow, and sound via CelebrationOverlay.
 */

import { useState, useEffect, useRef } from "react";
import CelebrationOverlay from "../CelebrationOverlay";

// ─── Mock Data (matches ProgressionService shape) ─────────────────────────────

const LEVEL_TITLES = [
  { minLevel: 1,  title: "Newcomer" },
  { minLevel: 3,  title: "Contributor" },
  { minLevel: 5,  title: "Builder" },
  { minLevel: 8,  title: "Craftsman" },
  { minLevel: 12, title: "Architect" },
  { minLevel: 16, title: "Veteran" },
  { minLevel: 20, title: "Master" },
  { minLevel: 25, title: "Legend" },
  { minLevel: 30, title: "Mass Commiter 3000" },
];

function titleForLevel(level) {
  let best = LEVEL_TITLES[0];
  for (const t of LEVEL_TITLES) {
    if (level >= t.minLevel) best = t;
  }
  return best.title;
}

const ALL_MILESTONES = [
  { id: "first_commit",     name: "First Blood",     icon: "🩸", description: "Submit your first commit" },
  { id: "ten_commits",      name: "Getting Serious",  icon: "💪", description: "Submit 10 commits" },
  { id: "fifty_commits",    name: "Half Century",     icon: "🎯", description: "Submit 50 commits" },
  { id: "hundred_commits",  name: "Centurion",        icon: "🏛️", description: "Submit 100 commits" },
  { id: "five_hundred_pts", name: "Point Hoarder",    icon: "💰", description: "Earn 500 total points" },
  { id: "thousand_pts",     name: "Grand Scorer",     icon: "🏆", description: "Earn 1,000 total points" },
  { id: "level_5",          name: "Rising Star",      icon: "⭐", description: "Reach level 5" },
  { id: "level_10",         name: "Double Digits",    icon: "🔟", description: "Reach level 10" },
  { id: "level_20",         name: "Elite",            icon: "👑", description: "Reach level 20" },
  { id: "streak_7",         name: "Week Warrior",     icon: "🔥", description: "Commit 7 days in a row" },
  { id: "streak_30",        name: "Monthly Machine",  icon: "⚡", description: "Commit 30 days in a row" },
];

function generateLeaderboard() {
  const names = [
    { id: "u1", username: "alice_dev",   totalPoints: 2340, commits: 87 },
    { id: "u2", username: "bob_coder",   totalPoints: 1890, commits: 65 },
    { id: "u3", username: "carol_eng",   totalPoints: 1650, commits: 58 },
    { id: "u4", username: "dan_ops",     totalPoints: 1200, commits: 42 },
    { id: "u5", username: "eve_arch",    totalPoints: 980,  commits: 34 },
    { id: "u6", username: "frank_full",  totalPoints: 750,  commits: 28 },
    { id: "u7", username: "grace_ml",    totalPoints: 620,  commits: 22 },
    { id: "u8", username: "hank_data",   totalPoints: 410,  commits: 15 },
    { id: "u9", username: "ivy_front",   totalPoints: 280,  commits: 10 },
    { id: "u10", username: "jack_jr",    totalPoints: 120,  commits: 5 },
  ];

  return names.map((u, i) => {
    const level = Math.max(1, Math.floor(Math.sqrt(u.totalPoints / 25)));
    return {
      rank: i + 1,
      ...u,
      level,
      title: titleForLevel(level),
    };
  });
}

// Current user — simulated
const CURRENT_USER_ID = "u3";

function generateMyProgression() {
  return {
    userId: CURRENT_USER_ID,
    totalXp: 1650,
    level: 10,
    xpInCurrentLevel: 120,
    xpToNextLevel: 244,
    title: "Craftsman",
    commitCount: 58,
    currentStreak: 4,
    longestStreak: 12,
    unlockedMilestones: ["first_commit", "ten_commits", "fifty_commits", "five_hundred_pts", "thousand_pts", "level_5", "level_10", "streak_7"],
    newMilestones: [],
  };
}

// ─── Rank Change Detection ────────────────────────────────────────────────────

function useRankWatcher(leaderboard, userId) {
  const prevRankRef = useRef(null);
  const [rankChange, setRankChange] = useState(null);

  useEffect(() => {
    const entry = leaderboard.find((e) => e.id === userId);
    if (!entry) return;

    if (prevRankRef.current !== null && entry.rank < prevRankRef.current) {
      setRankChange({
        from: prevRankRef.current,
        to: entry.rank,
        direction: "up",
      });
    }
    prevRankRef.current = entry.rank;
  }, [leaderboard, userId]);

  const clearRankChange = () => setRankChange(null);
  return [rankChange, clearRankChange];
}

// ─── Component ────────────────────────────────────────────────────────────────

const RANK_COLORS = {
  1: { bg: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)", glow: "#fbbf24", icon: "🥇" },
  2: { bg: "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)", glow: "#94a3b8", icon: "🥈" },
  3: { bg: "linear-gradient(135deg, #d97706 0%, #b45309 100%)", glow: "#d97706", icon: "🥉" },
};

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState(() => generateLeaderboard());
  const [myProgress, setMyProgress] = useState(() => generateMyProgression());
  const [celebration, setCelebration] = useState(null);
  const [rankChange, clearRankChange] = useRankWatcher(leaderboard, CURRENT_USER_ID);

  // Trigger celebration on rank change
  useEffect(() => {
    if (rankChange?.direction === "up") {
      setCelebration({
        title: "Rank Up!",
        subtitle: `You climbed from #${rankChange.from} to #${rankChange.to}`,
        icon: "📈",
        glowColor: "#3ddc97",
      });
      clearRankChange();
    }
  }, [rankChange, clearRankChange]);

  // Simulate rank up (for demo)
  const simulateRankUp = () => {
    setLeaderboard((prev) => {
      const updated = [...prev];
      const myIdx = updated.findIndex((e) => e.id === CURRENT_USER_ID);
      if (myIdx > 0) {
        // Boost my points to surpass person above
        updated[myIdx] = {
          ...updated[myIdx],
          totalPoints: updated[myIdx - 1].totalPoints + 50,
          commits: updated[myIdx].commits + 3,
        };
        // Re-sort and re-rank
        updated.sort((a, b) => b.totalPoints - a.totalPoints);
        return updated.map((e, i) => ({ ...e, rank: i + 1 }));
      }
      return prev;
    });
  };

  // Simulate milestone unlock
  const simulateMilestoneUnlock = () => {
    const locked = ALL_MILESTONES.filter(
      (m) => !myProgress.unlockedMilestones.includes(m.id),
    );
    if (locked.length === 0) return;
    const next = locked[0];

    setMyProgress((prev) => ({
      ...prev,
      unlockedMilestones: [...prev.unlockedMilestones, next.id],
    }));

    setCelebration({
      title: next.name,
      subtitle: next.description,
      icon: next.icon,
      glowColor: "#7c6aff",
    });
  };

  // Simulate level up
  const simulateLevelUp = () => {
    setMyProgress((prev) => {
      const newLevel = prev.level + 1;
      return {
        ...prev,
        level: newLevel,
        title: titleForLevel(newLevel),
        xpInCurrentLevel: 0,
        totalXp: prev.totalXp + prev.xpToNextLevel,
      };
    });

    setCelebration({
      title: `Level ${myProgress.level + 1}!`,
      subtitle: `You are now: ${titleForLevel(myProgress.level + 1)}`,
      icon: "⬆️",
      glowColor: "#f5a623",
    });
  };

  const myEntry = leaderboard.find((e) => e.id === CURRENT_USER_ID);
  const xpPercent = Math.min(100, (myProgress.xpInCurrentLevel / myProgress.xpToNextLevel) * 100);

  return (
    <div>
      {/* Celebration overlay */}
      <CelebrationOverlay
        active={!!celebration}
        title={celebration?.title}
        subtitle={celebration?.subtitle}
        icon={celebration?.icon}
        glowColor={celebration?.glowColor}
        onDismiss={() => setCelebration(null)}
        duration={4000}
      />

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>
          Leaderboard & Progression
        </h1>
        <p style={{ color: "#888", fontSize: 14, margin: 0 }}>
          Climb the ranks. Earn titles. Unlock achievements.
        </p>
      </div>

      {/* My Progression Card */}
      <div
        style={{
          background: "linear-gradient(135deg, #141417 0%, #1c1c28 100%)",
          border: "1px solid #2a2a31",
          borderRadius: 16,
          padding: 28,
          marginBottom: 24,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow */}
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: "radial-gradient(circle, #7c6aff22 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Your Progress
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 42, fontWeight: 900, color: "#7c6aff" }}>
                Lvl {myProgress.level}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#3ddc97",
                  padding: "4px 12px",
                  background: "rgba(61,220,151,.12)",
                  borderRadius: 20,
                }}
              >
                {myProgress.title}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
              Rank #{myEntry?.rank ?? "—"} · {myProgress.commitCount} commits · {myProgress.currentStreak} day streak 🔥
            </div>

            {/* XP Bar */}
            <div style={{ width: 320, maxWidth: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#666", marginBottom: 4 }}>
                <span>{myProgress.xpInCurrentLevel} XP</span>
                <span>{myProgress.xpToNextLevel} XP to next level</span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: "#1c1c21",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${xpPercent}%`,
                    borderRadius: 4,
                    background: "linear-gradient(90deg, #7c6aff, #9b87ff)",
                    transition: "width 0.6s ease",
                    boxShadow: "0 0 10px #7c6aff66",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Demo buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={simulateRankUp} style={demoBtn("#3ddc97")}>
              ↑ Simulate Rank Up
            </button>
            <button onClick={simulateLevelUp} style={demoBtn("#f5a623")}>
              ⬆ Simulate Level Up
            </button>
            <button onClick={simulateMilestoneUnlock} style={demoBtn("#7c6aff")}>
              🏆 Unlock Milestone
            </button>
          </div>
        </div>
      </div>

      {/* Two-column: Leaderboard + Milestones */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
        {/* Leaderboard Table */}
        <div
          style={{
            background: "#141417",
            border: "1px solid #2a2a31",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #1c1c21" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Rankings</h2>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1c1c21" }}>
                {["Rank", "User", "Title", "Points", "Commits"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#666",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry) => {
                const isMe = entry.id === CURRENT_USER_ID;
                const medal = RANK_COLORS[entry.rank];
                return (
                  <tr
                    key={entry.id}
                    style={{
                      borderTop: "1px solid #1c1c21",
                      background: isMe ? "rgba(124,106,255,.06)" : "transparent",
                      transition: "background 0.3s",
                    }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      {medal ? (
                        <span style={{ fontSize: 20 }}>{medal.icon}</span>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "#1c1c21",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#888",
                          }}
                        >
                          {entry.rank}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontWeight: isMe ? 800 : 600,
                          fontSize: 14,
                          color: isMe ? "#7c6aff" : "#e8e8f0",
                        }}
                      >
                        {entry.username}
                        {isMe && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "#7c6aff",
                              marginLeft: 8,
                              padding: "2px 6px",
                              background: "rgba(124,106,255,.15)",
                              borderRadius: 4,
                            }}
                          >
                            YOU
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "3px 10px",
                          borderRadius: 20,
                          background: "rgba(61,220,151,.1)",
                          color: "#3ddc97",
                        }}
                      >
                        {entry.title}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {entry.totalPoints.toLocaleString()}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: "#888", fontSize: 13 }}>
                      {entry.commits}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Milestones */}
        <div
          style={{
            background: "#141417",
            border: "1px solid #2a2a31",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #1c1c21" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              Milestones
              <span style={{ fontSize: 12, color: "#888", fontWeight: 500, marginLeft: 8 }}>
                {myProgress.unlockedMilestones.length}/{ALL_MILESTONES.length}
              </span>
            </h2>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
            {ALL_MILESTONES.map((m) => {
              const unlocked = myProgress.unlockedMilestones.includes(m.id);
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: unlocked ? "rgba(124,106,255,.06)" : "transparent",
                    opacity: unlocked ? 1 : 0.4,
                    transition: "all 0.3s",
                  }}
                >
                  <span style={{ fontSize: 22, filter: unlocked ? "none" : "grayscale(1)" }}>
                    {m.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: unlocked ? "#e8e8f0" : "#666",
                      }}
                    >
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#666" }}>{m.description}</div>
                  </div>
                  {unlocked && (
                    <span style={{ fontSize: 11, color: "#3ddc97", fontWeight: 700 }}>✓</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function demoBtn(color) {
  return {
    padding: "8px 14px",
    background: `${color}18`,
    border: `1px solid ${color}44`,
    color,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
