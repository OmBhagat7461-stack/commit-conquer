/**
 * OnboardingChecklist.jsx
 *
 * Interactive onboarding flow for first-time users.
 *
 * Features:
 *  - Step-by-step checklist with progress tracking
 *  - Welcome banner with animated entrance
 *  - Persisted state via localStorage
 *  - Dismissable + re-accessible
 *  - Premium dark-theme design with micro-animations
 *
 * Fixes #1: Users land on blank dashboards with no guidance
 */

import { useState, useEffect } from "react";

// ─── Onboarding Steps ─────────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    id: "browse_store",
    icon: "🛍️",
    title: "Browse the Storefront",
    description: "Explore the product catalog and discover collections.",
    action: "storefront",
    actionLabel: "Open Storefront →",
  },
  {
    id: "view_products",
    icon: "◈",
    title: "Manage Your Products",
    description: "View, create, and organize your product inventory.",
    action: "products",
    actionLabel: "View Products →",
  },
  {
    id: "check_orders",
    icon: "📦",
    title: "Review Orders",
    description: "Track order status, fulfill, or refund orders.",
    action: "orders",
    actionLabel: "View Orders →",
  },
  {
    id: "view_leaderboard",
    icon: "🏆",
    title: "Check the Leaderboard",
    description: "See your rank, earn achievements, and climb the ranks.",
    action: "leaderboard",
    actionLabel: "View Leaderboard →",
  },
  {
    id: "explore_admin",
    icon: "⚙️",
    title: "Explore Admin Tools",
    description: "Use the dashboard to monitor stats and analytics.",
    action: "dashboard",
    actionLabel: "View Dashboard →",
  },
];

const STORAGE_KEY = "cc_onboarding_state";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { completed: [], dismissed: false, firstVisit: true };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingChecklist({ setPage, currentPage }) {
  const [state, setState] = useState(loadState);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);

  // Show welcome on first ever visit
  useEffect(() => {
    if (state.firstVisit) {
      setShowWelcome(true);
      setState((prev) => {
        const next = { ...prev, firstVisit: false };
        saveState(next);
        return next;
      });
    }
  }, []);

  // Auto-complete steps when user navigates
  useEffect(() => {
    const step = ONBOARDING_STEPS.find((s) => s.action === currentPage);
    if (step && !state.completed.includes(step.id)) {
      setState((prev) => {
        const next = { ...prev, completed: [...prev.completed, step.id] };
        saveState(next);
        return next;
      });
    }
  }, [currentPage]);

  const completedCount = state.completed.length;
  const totalSteps = ONBOARDING_STEPS.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);
  const allDone = completedCount === totalSteps;

  const handleDismiss = () => {
    setState((prev) => {
      const next = { ...prev, dismissed: true };
      saveState(next);
      return next;
    });
  };

  const handleReset = () => {
    const next = { completed: [], dismissed: false, firstVisit: false };
    saveState(next);
    setState(next);
    setIsExpanded(true);
  };

  if (state.dismissed && allDone) return null;

  return (
    <>
      {/* Welcome Banner */}
      {showWelcome && (
        <div
          style={{
            background: "linear-gradient(135deg, #7c6aff22 0%, #3ddc9711 50%, #f5a62311 100%)",
            border: "1px solid #7c6aff33",
            borderRadius: 16,
            padding: "28px 32px",
            marginBottom: 24,
            position: "relative",
            overflow: "hidden",
            animation: "onboard-slide-in 0.5s ease-out",
          }}
        >
          {/* Ambient sparkle */}
          <div
            style={{
              position: "absolute",
              top: -30,
              right: -30,
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "radial-gradient(circle, #7c6aff22, transparent 70%)",
              animation: "onboard-glow 3s ease-in-out infinite",
            }}
          />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px", color: "#e8e8f0" }}>
              Welcome to commit&conquer!
            </h2>
            <p style={{ fontSize: 14, color: "#aaa", margin: "0 0 16px", maxWidth: 520, lineHeight: 1.6 }}>
              Your store is ready to go. Follow the quick guide below to discover what you can do — 
              from managing products to climbing the leaderboard.
            </p>
            <button
              onClick={() => setShowWelcome(false)}
              style={{
                padding: "8px 16px",
                background: "#7c6aff",
                border: "none",
                borderRadius: 8,
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Let's get started ✨
            </button>
          </div>
        </div>
      )}

      {/* Onboarding Checklist Card */}
      <div
        style={{
          background: "#141417",
          border: "1px solid #2a2a31",
          borderRadius: 16,
          marginBottom: 24,
          overflow: "hidden",
          animation: "onboard-slide-in 0.4s ease-out",
        }}
      >
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            background: "transparent",
            border: "none",
            borderBottom: isExpanded ? "1px solid #1c1c21" : "none",
            color: "#e8e8f0",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 18 }}>🚀</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                Getting Started
                {allDone && (
                  <span style={{
                    marginLeft: 8, fontSize: 11, padding: "2px 8px",
                    borderRadius: 10, background: "rgba(61,220,151,.15)", color: "#3ddc97",
                  }}>
                    Complete!
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {completedCount}/{totalSteps} steps completed
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Mini progress bar */}
            <div style={{ width: 100, height: 4, borderRadius: 2, background: "#1c1c21" }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  borderRadius: 2,
                  background: allDone
                    ? "linear-gradient(90deg, #3ddc97, #34d399)"
                    : "linear-gradient(90deg, #7c6aff, #9b87ff)",
                  transition: "width 0.6s ease",
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: "#888", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              ▼
            </span>
          </div>
        </button>

        {/* Steps */}
        {isExpanded && (
          <div style={{ padding: "8px 16px 16px" }}>
            {ONBOARDING_STEPS.map((step, i) => {
              const isDone = state.completed.includes(step.id);
              return (
                <div
                  key={step.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 12px",
                    borderRadius: 10,
                    background: isDone ? "rgba(61,220,151,.04)" : "transparent",
                    transition: "all 0.3s",
                    opacity: isDone ? 0.7 : 1,
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: isDone ? "2px solid #3ddc97" : "2px solid #2a2a31",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      background: isDone ? "rgba(61,220,151,.15)" : "transparent",
                      transition: "all 0.3s",
                    }}
                  >
                    {isDone ? (
                      <span style={{ color: "#3ddc97", fontSize: 14, fontWeight: 700 }}>✓</span>
                    ) : (
                      <span style={{ color: "#444", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                    )}
                  </div>

                  {/* Icon */}
                  <span style={{ fontSize: 20, filter: isDone ? "grayscale(0.5)" : "none" }}>
                    {step.icon}
                  </span>

                  {/* Content */}
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: isDone ? "#888" : "#e8e8f0",
                      textDecoration: isDone ? "line-through" : "none",
                    }}>
                      {step.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                      {step.description}
                    </div>
                  </div>

                  {/* Action button */}
                  {!isDone && (
                    <button
                      onClick={() => setPage(step.action)}
                      style={{
                        padding: "6px 14px",
                        background: "rgba(124,106,255,.12)",
                        border: "1px solid #7c6aff33",
                        borderRadius: 6,
                        color: "#7c6aff",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        transition: "all 0.2s",
                      }}
                    >
                      {step.actionLabel}
                    </button>
                  )}
                </div>
              );
            })}

            {/* Footer actions */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 12px 4px", marginTop: 8, borderTop: "1px solid #1c1c21",
            }}>
              <button
                onClick={handleDismiss}
                style={{
                  background: "none", border: "none", color: "#555",
                  fontSize: 12, cursor: "pointer", padding: "4px 8px",
                }}
              >
                Dismiss guide
              </button>
              {state.completed.length > 0 && (
                <button
                  onClick={handleReset}
                  style={{
                    background: "none", border: "none", color: "#555",
                    fontSize: 12, cursor: "pointer", padding: "4px 8px",
                  }}
                >
                  Reset progress
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes onboard-slide-in {
          0% { opacity: 0; transform: translateY(-12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes onboard-glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
