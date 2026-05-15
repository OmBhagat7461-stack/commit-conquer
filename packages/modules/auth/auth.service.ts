import { type Customer, type AuthSession } from "../../core/types";
import { generateId, isValidEmail, sleep } from "../../core/utils";
import { eventBus, EVENT } from "../../core/event-bus";
import { logger } from "../../core/logger";
import { verifyGoogleToken, GoogleAuthError } from "../../core/google-oauth";
import { ServiceError } from "../products/product.service";

export interface RegisterInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  first_name?: string;
  last_name?: string;
  phone?: string;
}

interface CustomerRecord {
  customer: Customer;
  password_hash: string;
  reset_token?: string;
  reset_token_expires?: string;
}

const customersByEmail = new Map<string, CustomerRecord>();
const customersById = new Map<string, CustomerRecord>();
const sessions = new Map<string, AuthSession>();

// ─── Refresh Token Rotation ───────────────────────────────────────────────────
// Maps refresh_token → session's access token (to look up the session).
const refreshIndex = new Map<string, string>();

// Stores refresh tokens that have already been consumed (rotated).
// If a consumed token is presented again, it signals a replay attack and the
// entire token family is revoked.
const usedRefreshTokens = new Map<string, { family: string; usedAt: number }>();

// TTLs
const ACCESS_TOKEN_TTL_MS  = 1000 * 60 * 15;        // 15 minutes
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Cleanup consumed tokens older than 8 days (no replay possible after refresh expiry)
const USED_TOKEN_RETENTION_MS = 1000 * 60 * 60 * 24 * 8;
const _usedTokenCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - USED_TOKEN_RETENTION_MS;
  for (const [tok, meta] of usedRefreshTokens) {
    if (meta.usedAt < cutoff) usedRefreshTokens.delete(tok);
  }
}, 60 * 60 * 1000); // every hour
if (typeof _usedTokenCleanupTimer.unref === "function") _usedTokenCleanupTimer.unref();

// Rate-limiting: track last password-reset request time per email
const RESET_COOLDOWN_MS = 60_000; // 60 seconds between requests
const resetCooldowns = new Map<string, number>();

function _seed() {
  const id = "cust_demo_001";
  const record: CustomerRecord = {
    customer: {
      id,
      email: "demo@example.com",
      first_name: "Demo",
      last_name: "User",
      phone: "+1 555 000 0000",
      has_account: true,
      created_at: new Date().toISOString(),
    },
    password_hash: _hashPassword("password123"),
  };
  customersByEmail.set("demo@example.com", record);
  customersById.set(id, record);
}

_seed();

export const AuthService = {
  async register(
    input: RegisterInput,
  ): Promise<{ customer: Customer; token: string; refresh_token: string }> {
    _validateRegister(input);

    const emailKey = input.email.toLowerCase().trim();

    if (customersByEmail.has(emailKey)) {
      throw new ServiceError(
        "EMAIL_EXISTS",
        `An account with email "${emailKey}" already exists`,
      );
    }

    await sleep(150);

    const customer: Customer = {
      id: generateId("cust"),
      email: emailKey,
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      phone: input.phone?.trim(),
      has_account: true,
      created_at: new Date().toISOString(),
    };

    const record: CustomerRecord = {
      customer,
      password_hash: _hashPassword(input.password),
    };

    customersByEmail.set(emailKey, record);
    customersById.set(customer.id, record);

    const session = _issueToken(customer.id);

    await eventBus.emit(EVENT.CUSTOMER_CREATED, {
      customer_id: customer.id,
      email: customer.email,
    });

    return { customer, token: session.token, refresh_token: session.refresh_token };
  },

  async login(
    input: LoginInput,
  ): Promise<{ customer: Customer; token: string; refresh_token: string }> {
    if (!input.email || !input.password) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        "Email and password are required",
      );
    }

    const emailKey = input.email.toLowerCase().trim();
    const record = customersByEmail.get(emailKey);

    await sleep(150);

    if (!record || !_verifyPassword(input.password, record.password_hash)) {
      throw new ServiceError(
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }

    const session = _issueToken(record.customer.id);

    await eventBus.emit(EVENT.CUSTOMER_LOGGED_IN, {
      customer_id: record.customer.id,
    });

    return { customer: record.customer, token: session.token, refresh_token: session.refresh_token };
  },

  async logout(token: string): Promise<void> {
    const session = sessions.get(token);
    if (!session) return; // already gone — idempotent

    // Clean up refresh index
    refreshIndex.delete(session.refresh_token);
    // Mark the refresh token as used so a later replay is caught
    usedRefreshTokens.set(session.refresh_token, {
      family: session.token_family,
      usedAt: Date.now(),
    });
    sessions.delete(token);

    await eventBus.emit(EVENT.CUSTOMER_LOGGED_OUT, {
      customer_id: session.customer_id,
    });
  },

  validateToken(token: string): Customer {
    const session = sessions.get(token);

    if (!session) {
      throw new ServiceError(
        "INVALID_TOKEN",
        "Session not found — please log in again",
      );
    }

    if (new Date(session.expires_at) < new Date()) {
      sessions.delete(token);
      throw new ServiceError(
        "TOKEN_EXPIRED",
        "Session expired — please log in again",
      );
    }

    const record = customersById.get(session.customer_id);
    if (!record) {
      throw new ServiceError(
        "CUSTOMER_NOT_FOUND",
        "Customer account not found",
      );
    }

    return record.customer;
  },

  getById(id: string): Customer {
    const record = customersById.get(id);
    if (!record)
      throw new ServiceError("CUSTOMER_NOT_FOUND", `Customer ${id} not found`);
    return record.customer;
  },

  getByEmail(email: string): Customer {
    const record = customersByEmail.get(email.toLowerCase().trim());
    if (!record)
      throw new ServiceError("CUSTOMER_NOT_FOUND", `No account for ${email}`);
    return record.customer;
  },

  async updateProfile(
    customerId: string,
    input: UpdateProfileInput,
  ): Promise<Customer> {
    const record = customersById.get(customerId);
    if (!record)
      throw new ServiceError(
        "CUSTOMER_NOT_FOUND",
        `Customer ${customerId} not found`,
      );

    if (input.first_name !== undefined) {
      record.customer.first_name = input.first_name.trim();
    }
    if (input.last_name !== undefined) {
      record.customer.last_name = input.last_name.trim();
    }
    if (input.phone !== undefined) {
      record.customer.phone = input.phone.trim();
    }

    customersById.set(customerId, record);
    customersByEmail.set(record.customer.email, record);

    return record.customer;
  },

  async changePassword(
    customerId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const record = customersById.get(customerId);
    if (!record)
      throw new ServiceError(
        "CUSTOMER_NOT_FOUND",
        `Customer ${customerId} not found`,
      );

    await sleep(150);

    if (!_verifyPassword(currentPassword, record.password_hash)) {
      throw new ServiceError(
        "INVALID_CREDENTIALS",
        "Current password is incorrect",
      );
    }

    _validatePasswordStrength(newPassword);

    record.password_hash = _hashPassword(newPassword);

    customersById.set(customerId, record);
    customersByEmail.set(record.customer.email, record);

    for (const [token, session] of sessions.entries()) {
      if (session.customer_id === customerId) {
        refreshIndex.delete(session.refresh_token);
        sessions.delete(token);
      }
    }
  },

  async requestPasswordReset(email: string): Promise<{ reset_token: string }> {
    const emailKey = email.toLowerCase().trim();

    // ── Rate-limit: enforce cooldown per email ────────────────────────────
    const lastRequest = resetCooldowns.get(emailKey);
    if (lastRequest && Date.now() - lastRequest < RESET_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (RESET_COOLDOWN_MS - (Date.now() - lastRequest)) / 1000,
      );
      throw new ServiceError(
        "RATE_LIMITED",
        `Too many reset requests. Please wait ${waitSeconds} seconds before trying again.`,
      );
    }
    resetCooldowns.set(emailKey, Date.now());

    const record = customersByEmail.get(emailKey);

    await sleep(200);

    if (!record) {
      return { reset_token: "noop" };
    }

    const now = Date.now();
    if (record.reset_token_expires) {
      const expiresTime = new Date(record.reset_token_expires).getTime();
      const createdAt = expiresTime - 1000 * 60 * 60;
      if (now - createdAt < 1000 * 60 * 5) {
        throw new ServiceError("TOO_MANY_REQUESTS", "Please wait a few minutes before requesting another reset.");
      }
    }

    const reset_token = _generateResetToken();
    const expires = new Date(now + 1000 * 60 * 60);

    record.reset_token = reset_token;
    record.reset_token_expires = expires.toISOString();

    customersById.set(record.customer.id, record);
    customersByEmail.set(emailKey, record);

    await eventBus.emit(EVENT.PASSWORD_RESET, {
      customer_id: record.customer.id,
      email: emailKey,
    });

    logger.info("Password reset token generated", {
      email: emailKey,
      customerId: record.customer.id,
    });

    return { reset_token };
  },

  async confirmPasswordReset(
    reset_token: string,
    new_password: string,
  ): Promise<void> {
    _validatePasswordStrength(new_password);

    // Find the customer with this token
    let found: CustomerRecord | undefined;
    for (const record of customersById.values()) {
      if (record.reset_token === reset_token) {
        found = record;
        break;
      }
    }

    if (!found) {
      throw new ServiceError(
        "INVALID_TOKEN",
        "Reset token is invalid or has already been used",
      );
    }

    if (
      !found.reset_token_expires ||
      new Date(found.reset_token_expires) < new Date()
    ) {
      throw new ServiceError(
        "TOKEN_EXPIRED",
        "Reset token has expired — please request a new one",
      );
    }

    await sleep(150);

    found.password_hash = _hashPassword(new_password);
    found.reset_token = undefined;
    found.reset_token_expires = undefined;

    customersById.set(found.customer.id, found);
    customersByEmail.set(found.customer.email, found);

    // Invalidate all sessions (including refresh tokens)
    for (const [token, session] of sessions.entries()) {
      if (session.customer_id === found.customer.id) {
        refreshIndex.delete(session.refresh_token);
        sessions.delete(token);
      }
    }
  },

  async googleLogin(
    googleToken: string,
  ): Promise<{ customer: Customer; token: string; refresh_token: string }> {
    // Verify the token against Google's public infrastructure
    let payload;
    try {
      payload = await verifyGoogleToken(googleToken);
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        throw new ServiceError(err.code, err.message);
      }
      throw err;
    }

    const emailKey = payload.email.toLowerCase().trim();
    let record = customersByEmail.get(emailKey);

    if (!record) {
      const customer: Customer = {
        id: generateId("cust"),
        email: emailKey,
        first_name: payload.given_name || payload.name || "Google",
        last_name: payload.family_name || "User",
        has_account: true,
        created_at: new Date().toISOString(),
      };

      record = { customer, password_hash: "" };
      customersByEmail.set(emailKey, record);
      customersById.set(customer.id, record);

      await eventBus.emit(EVENT.CUSTOMER_CREATED, {
        customer_id: customer.id,
        email: customer.email,
      });
    }

    const session = _issueToken(record.customer.id);
    return { customer: record.customer, token: session.token, refresh_token: session.refresh_token };
  },

  /**
   * Rotate a refresh token: invalidate the old one and issue a new
   * access + refresh pair in the same token family.
   *
   * If the refresh token was already consumed (replay attack), revoke the
   * ENTIRE family — every session that descended from the original login.
   */
  async refreshSession(
    refreshToken: string,
  ): Promise<{ customer: Customer; token: string; refresh_token: string }> {
    // ── Replay detection ──────────────────────────────────────────────────
    const usedMeta = usedRefreshTokens.get(refreshToken);
    if (usedMeta) {
      // This token was already rotated → potential theft.  Kill the family.
      _revokeFamily(usedMeta.family);
      logger.warn("Refresh token replay detected — family revoked", {
        family: usedMeta.family,
      });
      throw new ServiceError(
        "INVALID_TOKEN",
        "Refresh token has already been used — all sessions revoked for security",
      );
    }

    // ── Normal rotation ───────────────────────────────────────────────────
    const accessToken = refreshIndex.get(refreshToken);
    if (!accessToken) {
      throw new ServiceError("INVALID_TOKEN", "Refresh token not found");
    }

    const oldSession = sessions.get(accessToken);
    if (!oldSession) {
      throw new ServiceError("INVALID_TOKEN", "Session not found");
    }

    if (new Date(oldSession.refresh_expires_at) < new Date()) {
      // Expired — clean up and reject
      sessions.delete(accessToken);
      refreshIndex.delete(refreshToken);
      throw new ServiceError("TOKEN_EXPIRED", "Refresh token expired — please log in again");
    }

    const customerId = oldSession.customer_id;
    const family     = oldSession.token_family;

    // Mark the old refresh token as consumed
    usedRefreshTokens.set(refreshToken, { family, usedAt: Date.now() });
    refreshIndex.delete(refreshToken);
    sessions.delete(accessToken);

    // Issue new pair in the same family
    const newSession = _issueToken(customerId, family);

    const record = customersById.get(customerId);
    if (!record) {
      throw new ServiceError("CUSTOMER_NOT_FOUND", "Customer account not found");
    }

    return {
      customer: record.customer,
      token: newSession.token,
      refresh_token: newSession.refresh_token,
    };
  },

  activeSessions(customerId: string): AuthSession[] {
    return [...sessions.values()].filter(
      (s) =>
        s.customer_id === customerId && new Date(s.expires_at) > new Date(),
    );
  },
};

function _issueToken(customerId: string, family?: string): AuthSession {
  const token         = `tok_${customerId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const refresh_token = `rtk_${customerId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const token_family  = family ?? `fam_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const session: AuthSession = {
    customer_id: customerId,
    token,
    refresh_token,
    token_family,
    expires_at:         new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
    refresh_expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
  };

  sessions.set(token, session);
  refreshIndex.set(refresh_token, token);
  return session;
}

/** Revoke every session that belongs to a given token family. */
function _revokeFamily(family: string): void {
  for (const [token, session] of sessions) {
    if (session.token_family === family) {
      refreshIndex.delete(session.refresh_token);
      sessions.delete(token);
    }
  }
}

function _hashPassword(password: string): string {
  const salt = "cc_salt_v1_";
  const salted = salt + password;
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    hash = ((hash << 5) - hash + salted.charCodeAt(i)) | 0;
  }
  return `mock_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

function _verifyPassword(password: string, hash: string): boolean {
  return _hashPassword(password) === hash;
}

function _generateResetToken(): string {
  return `rst_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function _validatePasswordStrength(password: string): void {
  if (!password || password.length < 8) {
    throw new ServiceError(
      "WEAK_PASSWORD",
      "Password must be at least 8 characters long",
    );
  }
}

function _validateRegister(input: RegisterInput): void {
  if (!input.email || !isValidEmail(input.email)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      "A valid email address is required",
    );
  }
  if (!input.first_name?.trim()) {
    throw new ServiceError("VALIDATION_ERROR", "First name is required");
  }
  if (!input.last_name?.trim()) {
    throw new ServiceError("VALIDATION_ERROR", "Last name is required");
  }
  _validatePasswordStrength(input.password);
}

// _decodeGoogleToken has been replaced by verifyGoogleToken in packages/core/google-oauth.ts
// which validates issuer, audience, expiry, and calls Google's tokeninfo endpoint.