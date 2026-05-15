/**
 * CelebrationOverlay.jsx
 *
 * A reusable celebration component with:
 *  - Canvas-based confetti particles
 *  - Radial glow pulse effect
 *  - Web Audio API celebration sound (no external files)
 *  - Auto-dismiss after animation
 */

import { useEffect, useRef, useCallback } from "react";

// ─── Confetti Particle System ─────────────────────────────────────────────────

const COLORS = [
  "#7c6aff", "#9b87ff", "#3ddc97", "#f5a623",
  "#60a5fa", "#ff5c5c", "#e879f9", "#fbbf24",
  "#34d399", "#a78bfa", "#fb7185", "#38bdf8",
];

function createParticles(count, canvasW, canvasH) {
  return Array.from({ length: count }, () => ({
    x: canvasW / 2 + (Math.random() - 0.5) * 200,
    y: canvasH / 2 - Math.random() * 100,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 14 - 4,
    size: Math.random() * 8 + 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 10,
    opacity: 1,
    shape: Math.random() > 0.5 ? "rect" : "circle",
  }));
}

function drawParticles(ctx, particles) {
  for (const p of particles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;

    if (p.shape === "rect") {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function updateParticles(particles) {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.3; // gravity
    p.vx *= 0.99; // drag
    p.rotation += p.rotationSpeed;
    p.opacity = Math.max(0, p.opacity - 0.008);
  }
  return particles.filter((p) => p.opacity > 0);
}

// ─── Sound Synthesis ──────────────────────────────────────────────────────────

function playCelebrationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Ascending chime pattern
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.5);
    });

    // Sparkle shimmer
    setTimeout(() => {
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmer.type = "triangle";
      shimmer.frequency.value = 1568; // G6
      shimmerGain.gain.setValueAtTime(0.08, ctx.currentTime);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start();
      shimmer.stop(ctx.currentTime + 0.8);
    }, 400);
  } catch {
    // Audio not available — fail silently
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CelebrationOverlay({
  active,
  title = "Achievement Unlocked!",
  subtitle = "",
  icon = "🏆",
  glowColor = "#7c6aff",
  onDismiss,
  duration = 4000,
}) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animFrameRef = useRef(null);
  const timerRef = useRef(null);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particlesRef.current = updateParticles(particlesRef.current);
    drawParticles(ctx, particlesRef.current);

    if (particlesRef.current.length > 0) {
      animFrameRef.current = requestAnimationFrame(animate);
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    // Resize canvas
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    // Launch particles
    particlesRef.current = createParticles(120, window.innerWidth, window.innerHeight * 0.4);
    animFrameRef.current = requestAnimationFrame(animate);

    // Play sound
    playCelebrationSound();

    // Auto-dismiss
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, duration);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, animate, duration, onDismiss]);

  if (!active) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Confetti canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, zIndex: 1 }}
      />

      {/* Radial glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background: `radial-gradient(circle at 50% 40%, ${glowColor}33 0%, transparent 60%)`,
          animation: "celebration-glow-pulse 1.5s ease-in-out infinite",
        }}
      />

      {/* Achievement card */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          textAlign: "center",
          animation: "celebration-card-enter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
          pointerEvents: "auto",
        }}
        onClick={() => onDismiss?.()}
      >
        <div
          style={{
            fontSize: 56,
            marginBottom: 12,
            filter: `drop-shadow(0 0 20px ${glowColor})`,
            animation: "celebration-icon-bounce 0.8s ease-out",
          }}
        >
          {icon}
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#fff",
            textShadow: `0 0 30px ${glowColor}, 0 0 60px ${glowColor}44`,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              maxWidth: 300,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes celebration-glow-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes celebration-card-enter {
          0% { transform: scale(0.3) translateY(40px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes celebration-icon-bounce {
          0% { transform: scale(0) rotate(-20deg); }
          50% { transform: scale(1.3) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
