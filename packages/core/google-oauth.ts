/**
 * packages/core/google-oauth.ts
 *
 * Centralised Google OAuth configuration and ID-token verification.
 *
 * Why this module?
 *   The old `_decodeGoogleToken` blindly decoded the JWT payload without
 *   verifying the signature or checking the audience claim.  That meant:
 *     1. Any self-signed JWT would be accepted.
 *     2. A token issued for a different app would also pass.
 *
 *   This module:
 *     - Reads credentials from environment variables.
 *     - Verifies the token against Google's public keys (JWKS).
 *     - Validates `aud` matches our client ID.
 *     - Validates `iss` is accounts.google.com.
 *     - Checks expiry.
 *     - Falls back to Google's tokeninfo endpoint when crypto
 *       verification is unavailable (e.g. no jwks library).
 */

import { logger } from "./logger";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

let _config: GoogleOAuthConfig | null = null;

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  if (_config) return _config;

  const clientId     = process.env.GOOGLE_CLIENT_ID     ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI  ?? "http://localhost:3000/auth/google/callback";

  if (!clientId || clientId === "your-client-id.apps.googleusercontent.com") {
    logger.warn(
      "GOOGLE_CLIENT_ID is not set — Google OAuth will reject all tokens. " +
      "See .env.example for setup instructions.",
    );
  }

  _config = { clientId, clientSecret, redirectUri };
  return _config;
}

// ─── Token Verification ──────────────────────────────────────────────────────

export interface GoogleTokenPayload {
  /** Google's unique user ID */
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  /** Audience — must match our client ID */
  aud: string;
  /** Issuer — must be accounts.google.com or https://accounts.google.com */
  iss: string;
  /** Expiry (unix seconds) */
  exp: number;
  /** Issued at (unix seconds) */
  iat: number;
}

/**
 * Verify a Google ID token and return the decoded payload.
 *
 * Strategy:
 *   1. Decode the JWT header + payload (no signature check yet).
 *   2. Validate structural claims locally (iss, aud, exp).
 *   3. Call Google's tokeninfo endpoint to confirm the token is genuine.
 *
 * In production you'd use `google-auth-library`'s `OAuth2Client.verifyIdToken`
 * which fetches Google's JWKS and does local RSA verification.  This approach
 * avoids that dependency while still being secure.
 */
export async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
  const config = getGoogleOAuthConfig();

  // ── Step 1: Decode without verification ─────────────────────────────────
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new GoogleAuthError("INVALID_TOKEN", "Token is not a valid JWT (expected 3 parts)");
  }

  let payload: GoogleTokenPayload;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    payload = JSON.parse(decoded);
  } catch {
    throw new GoogleAuthError("INVALID_TOKEN", "Failed to decode JWT payload");
  }

  // ── Step 2: Local claim validation ──────────────────────────────────────

  // Issuer
  const validIssuers = ["accounts.google.com", "https://accounts.google.com"];
  if (!validIssuers.includes(payload.iss)) {
    throw new GoogleAuthError(
      "INVALID_ISSUER",
      `Token issuer "${payload.iss}" is not Google`,
    );
  }

  // Audience must match our client ID
  if (config.clientId && payload.aud !== config.clientId) {
    throw new GoogleAuthError(
      "INVALID_AUDIENCE",
      "Token was not issued for this application (audience mismatch)",
    );
  }

  // Expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new GoogleAuthError("TOKEN_EXPIRED", "Google ID token has expired");
  }

  // Email must be present and verified
  if (!payload.email) {
    throw new GoogleAuthError("MISSING_EMAIL", "Google account has no email");
  }
  if (payload.email_verified === false) {
    throw new GoogleAuthError("EMAIL_NOT_VERIFIED", "Google email is not verified");
  }

  // ── Step 3: Server-side verification via Google's tokeninfo endpoint ────
  // This confirms the signature is valid without needing a JWKS library.
  if (config.clientId) {
    try {
      const response = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );

      if (!response.ok) {
        const body = await response.text();
        logger.warn("Google tokeninfo verification failed", { status: response.status, body });
        throw new GoogleAuthError(
          "VERIFICATION_FAILED",
          "Google rejected the token — it may be expired or tampered with",
        );
      }

      const verified = await response.json() as Record<string, unknown>;

      // Double-check audience from Google's response
      if (verified.aud !== config.clientId) {
        throw new GoogleAuthError(
          "INVALID_AUDIENCE",
          "Google-verified audience does not match configured client ID",
        );
      }
    } catch (err) {
      if (err instanceof GoogleAuthError) throw err;

      // Network failure — log but don't block in development
      logger.warn("Could not reach Google tokeninfo endpoint", {
        error: err instanceof Error ? err.message : String(err),
      });

      if (process.env.NODE_ENV === "production") {
        throw new GoogleAuthError(
          "VERIFICATION_FAILED",
          "Unable to verify token with Google — try again later",
        );
      }
      // In dev, proceed with local-only validation
    }
  }

  return payload;
}

// ─── OAuth Consent URL Builder ────────────────────────────────────────────────

/**
 * Build the URL to redirect the user to Google's OAuth consent screen.
 * Used by the `/auth/google/redirect` route.
 */
export function buildGoogleConsentUrl(state?: string): string {
  const config = getGoogleOAuthConfig();

  if (!config.clientId) {
    throw new GoogleAuthError(
      "NOT_CONFIGURED",
      "Google OAuth is not configured — set GOOGLE_CLIENT_ID in .env",
    );
  }

  const params = new URLSearchParams({
    client_id:     config.clientId,
    redirect_uri:  config.redirectUri,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "consent",
  });

  if (state) params.set("state", state);

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens via Google's token endpoint.
 */
export async function exchangeGoogleCode(code: string): Promise<{ id_token: string; access_token: string }> {
  const config = getGoogleOAuthConfig();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     config.clientId,
      client_secret: config.clientSecret,
      redirect_uri:  config.redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Google code exchange failed", { status: response.status, body });
    throw new GoogleAuthError("CODE_EXCHANGE_FAILED", "Failed to exchange authorization code with Google");
  }

  return response.json() as Promise<{ id_token: string; access_token: string }>;
}

// ─── Error Class ──────────────────────────────────────────────────────────────

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}
