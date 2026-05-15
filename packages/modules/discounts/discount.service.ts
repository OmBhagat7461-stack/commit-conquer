
import { logger } from "../../core/logger";
import { ServiceError } from "../products/product.service";

// ─── Discount Definitions ─────────────────────────────────────────────────────

export interface DiscountRule {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;                 // percent or cents
  maxUsesTotal: number | null;   // null = unlimited
  maxUsesPerCustomer: number;    // default 1 for one-time coupons
  currentUsesTotal: number;
  active: boolean;
  startsAt: string;              // ISO date
  expiresAt: string | null;      // null = never
}

// ─── Usage Tracking ───────────────────────────────────────────────────────────
// Maps "discountId:customerId" → number of times redeemed.
// This is the single source of truth for per-customer enforcement.

const usageStore = new Map<string, number>();

function _usageKey(discountId: string, customerId: string): string {
  return `${discountId}:${customerId}`;
}

// ─── Checkout Reservations ────────────────────────────────────────────────────
// When checkout begins, a discount is "reserved" so that a concurrent checkout
// from another tab cannot race past the usage check.  The reservation is
// committed on success or released on failure.
//
// Key: "discountId:customerId:cartId"  →  timestamp

const reservations = new Map<string, number>();
const RESERVATION_TTL_MS = 60_000; // 60 s — auto-expires if checkout hangs

function _reservationKey(discountId: string, customerId: string, cartId: string): string {
  return `${discountId}:${customerId}:${cartId}`;
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

const discounts = new Map<string, DiscountRule>();
const byCode    = new Map<string, DiscountRule>();

function _seed(): void {
  const rules: DiscountRule[] = [
    {
      id: "disc_001", code: "LAUNCH10", type: "percentage", value: 10,
      maxUsesTotal: null, maxUsesPerCustomer: 3, currentUsesTotal: 0,
      active: true, startsAt: new Date(0).toISOString(), expiresAt: null,
    },
    {
      id: "disc_002", code: "LAUNCH20", type: "percentage", value: 20,
      maxUsesTotal: 100, maxUsesPerCustomer: 1, currentUsesTotal: 0,
      active: true, startsAt: new Date(0).toISOString(), expiresAt: null,
    },
    {
      id: "disc_003", code: "FLAT500", type: "fixed", value: 500,
      maxUsesTotal: null, maxUsesPerCustomer: 2, currentUsesTotal: 0,
      active: true, startsAt: new Date(0).toISOString(), expiresAt: null,
    },
    {
      id: "disc_004", code: "FLAT1000", type: "fixed", value: 1000,
      maxUsesTotal: 50, maxUsesPerCustomer: 1, currentUsesTotal: 0,
      active: true, startsAt: new Date(0).toISOString(), expiresAt: null,
    },
  ];

  for (const r of rules) {
    discounts.set(r.id, r);
    byCode.set(r.code, r);
  }
}
_seed();

// ─── Cleanup stale reservations ───────────────────────────────────────────────

const _reservationCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - RESERVATION_TTL_MS;
  for (const [key, ts] of reservations) {
    if (ts < cutoff) reservations.delete(key);
  }
}, 30_000);
if (typeof _reservationCleanupTimer.unref === "function") _reservationCleanupTimer.unref();

// ─── Service ──────────────────────────────────────────────────────────────────

export const DiscountService = {

  /** Look up a discount by code. Throws if invalid, expired, or exhausted. */
  getByCode(code: string): DiscountRule {
    const rule = byCode.get(code.toUpperCase());
    if (!rule) {
      throw new ServiceError("INVALID_DISCOUNT", `Discount code "${code}" is not valid`);
    }
    if (!rule.active) {
      throw new ServiceError("DISCOUNT_INACTIVE", `Discount "${code}" is no longer active`);
    }
    const now = new Date();
    if (new Date(rule.startsAt) > now) {
      throw new ServiceError("DISCOUNT_NOT_STARTED", `Discount "${code}" has not started yet`);
    }
    if (rule.expiresAt && new Date(rule.expiresAt) < now) {
      throw new ServiceError("DISCOUNT_EXPIRED", `Discount "${code}" has expired`);
    }
    if (rule.maxUsesTotal !== null && rule.currentUsesTotal >= rule.maxUsesTotal) {
      throw new ServiceError("DISCOUNT_EXHAUSTED", `Discount "${code}" has reached its usage limit`);
    }
    return rule;
  },

  /**
   * Check whether a specific customer can use a discount code.
   * Does NOT mutate state — use `reserve()` + `commitRedemption()` for that.
   */
  canCustomerUse(code: string, customerId: string): { allowed: boolean; reason?: string } {
    try {
      const rule = DiscountService.getByCode(code);

      // Per-customer usage check
      const usageKey = _usageKey(rule.id, customerId);
      const used = usageStore.get(usageKey) ?? 0;
      if (used >= rule.maxUsesPerCustomer) {
        return {
          allowed: false,
          reason: `You have already used "${code}" the maximum of ${rule.maxUsesPerCustomer} time(s)`,
        };
      }

      // Check for an existing reservation by another cart (concurrent checkout)
      for (const [key, ts] of reservations) {
        if (key.startsWith(`${rule.id}:${customerId}:`) && Date.now() - ts < RESERVATION_TTL_MS) {
          return {
            allowed: false,
            reason: "This discount is being processed in another checkout",
          };
        }
      }

      return { allowed: true };
    } catch (err) {
      if (err instanceof ServiceError) {
        return { allowed: false, reason: err.message };
      }
      throw err;
    }
  },

  /**
   * Reserve a discount for a specific cart + customer during checkout.
   * This is the critical atomicity point — prevents concurrent checkouts
   * from both passing the usage check.
   *
   * Must be followed by either `commitRedemption()` or `releaseReservation()`.
   */
  reserve(code: string, customerId: string, cartId: string): DiscountRule {
    const rule = DiscountService.getByCode(code);

    // Per-customer usage
    const usageKey = _usageKey(rule.id, customerId);
    const used = usageStore.get(usageKey) ?? 0;
    if (used >= rule.maxUsesPerCustomer) {
      throw new ServiceError(
        "DISCOUNT_ALREADY_USED",
        `You have already used "${code}" the maximum of ${rule.maxUsesPerCustomer} time(s)`,
      );
    }

    // Check for existing reservation by this customer (another cart/tab)
    for (const [key, ts] of reservations) {
      if (
        key.startsWith(`${rule.id}:${customerId}:`) &&
        !key.endsWith(`:${cartId}`) &&
        Date.now() - ts < RESERVATION_TTL_MS
      ) {
        throw new ServiceError(
          "DISCOUNT_IN_FLIGHT",
          "This discount is being processed in another checkout — please wait",
        );
      }
    }

    // Global usage check (counting active reservations as "pending uses")
    if (rule.maxUsesTotal !== null) {
      let pendingCount = 0;
      for (const [key, ts] of reservations) {
        if (key.startsWith(`${rule.id}:`) && Date.now() - ts < RESERVATION_TTL_MS) {
          pendingCount++;
        }
      }
      if (rule.currentUsesTotal + pendingCount >= rule.maxUsesTotal) {
        throw new ServiceError("DISCOUNT_EXHAUSTED", `Discount "${code}" has reached its usage limit`);
      }
    }

    // Place reservation
    const rKey = _reservationKey(rule.id, customerId, cartId);
    reservations.set(rKey, Date.now());

    logger.info("Discount reserved for checkout", {
      discountId: rule.id,
      code: rule.code,
      customerId,
      cartId,
    });

    return rule;
  },

  /**
   * Commit a successful redemption — increments usage counters and clears
   * the reservation.  Call this after payment succeeds.
   */
  commitRedemption(code: string, customerId: string, cartId: string): void {
    const rule = byCode.get(code.toUpperCase());
    if (!rule) return; // defensive — code was already validated

    const rKey = _reservationKey(rule.id, customerId, cartId);
    reservations.delete(rKey);

    // Increment usage
    const usageKey = _usageKey(rule.id, customerId);
    usageStore.set(usageKey, (usageStore.get(usageKey) ?? 0) + 1);
    rule.currentUsesTotal += 1;

    logger.info("Discount redeemed", {
      discountId: rule.id,
      code: rule.code,
      customerId,
      cartId,
      customerUses: usageStore.get(usageKey),
      totalUses: rule.currentUsesTotal,
    });
  },

  /**
   * Release a reservation without committing — call this if checkout fails
   * (e.g. payment declined).
   */
  releaseReservation(code: string, customerId: string, cartId: string): void {
    const rule = byCode.get(code.toUpperCase());
    if (!rule) return;

    const rKey = _reservationKey(rule.id, customerId, cartId);
    const deleted = reservations.delete(rKey);
    if (deleted) {
      logger.info("Discount reservation released", {
        discountId: rule.id,
        code: rule.code,
        customerId,
        cartId,
      });
    }
  },

  /** Admin: list all discounts. */
  list(): DiscountRule[] {
    return [...discounts.values()];
  },

  /** Admin: create a new discount. */
  create(input: Omit<DiscountRule, "id" | "currentUsesTotal">): DiscountRule {
    const rule: DiscountRule = {
      ...input,
      id: `disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      code: input.code.toUpperCase(),
      currentUsesTotal: 0,
    };
    discounts.set(rule.id, rule);
    byCode.set(rule.code, rule);
    return rule;
  },

  /** Admin: deactivate a discount. */
  deactivate(id: string): boolean {
    const rule = discounts.get(id);
    if (!rule) return false;
    rule.active = false;
    return true;
  },

  /** Per-customer usage count for a given discount. */
  getUsage(discountId: string, customerId: string): number {
    return usageStore.get(_usageKey(discountId, customerId)) ?? 0;
  },
};
