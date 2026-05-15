

import {
  type Cart,
  type CartItem,
  type Address,
} from "../../core/types";
import {
  generateId,
  calcDiscount,
  calcTax,
  sleep,
} from "../../core/utils";
import { eventBus, EVENT } from "../../core/event-bus";
import { logger } from "../../core/logger";
import { ProductModel } from "../products/product.model";
import { ServiceError } from "../products/product.service";



const SHIPPING_FLAT_RATE   = 599;   // $5.99 flat shipping in cents
const FREE_SHIPPING_ABOVE  = 10000; // Free shipping over $100
const TAX_RATE_PERCENT     = 8.875; // %



const DISCOUNT_CODES: Record<string, { type: "percentage" | "fixed"; value: number }> = {
  LAUNCH10:  { type: "percentage", value: 10 },
  LAUNCH20:  { type: "percentage", value: 20 },
  FLAT500:   { type: "fixed",      value: 500  },   // $5 off
  FLAT1000:  { type: "fixed",      value: 1000 },   // $10 off
};



const carts = new Map<string, Cart>();



export const CartService = {

  

  async create(email?: string): Promise<Cart> {
    const cart: Cart = {
      id:               generateId("cart"),
      items:            [],
      subtotal:         0,
      shipping_total:   SHIPPING_FLAT_RATE,
      tax_total:        0,
      total:            0,
      discount_amount:  0,
      email:            email,
      created_at:       new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    };

    carts.set(cart.id, cart);

    await eventBus.emit(EVENT.CART_CREATED, { cart_id: cart.id });

    return cart;
  },

  

  get(cartId: string): Cart {
    const cart = carts.get(cartId);
    if (!cart) throw new ServiceError("CART_NOT_FOUND", `Cart ${cartId} not found`);

    // Validate items against current product/variant data on every read
    const validated = _validateCartItems(cart);
    if (validated.changed) {
      const updated = _recalc(validated.cart);
      carts.set(cartId, updated);
      return updated;
    }

    return cart;
  },

  

  async addItem(
    cartId: string,
    productId: string,
    variantId: string,
    quantity = 1,
  ): Promise<Cart> {
    const cart = CartService.get(cartId);

    
    const product = ProductModel.findById(productId);
    if (!product) {
      throw new ServiceError("PRODUCT_NOT_FOUND", `Product ${productId} not found`);
    }

    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new ServiceError("VARIANT_NOT_FOUND", `Variant ${variantId} not found`);
    }

    
    const existingLine = cart.items.find((i) => i.variant_id === variantId);
    const currentQtyInCart = existingLine?.quantity ?? 0;
    const requested = currentQtyInCart + quantity;

    if (variant.inventory_quantity < requested) {
      throw new ServiceError(
        "INSUFFICIENT_STOCK",
        `Only ${variant.inventory_quantity} units available for "${variant.title}"`,
      );
    }

    
    if (existingLine) {
      existingLine.quantity += quantity;
    } else {
      const line: CartItem = {
        id:            generateId("cli"),
        product_id:    productId,
        variant_id:    variantId,
        title:         product.title,
        variant_title: variant.title,
        thumbnail:     product.thumbnail,
        price:         variant.price,
        quantity,
      };
      cart.items.push(line);
    }

    const updated = _recalc(cart);
    carts.set(cartId, updated);

    await eventBus.emit(EVENT.CART_UPDATED, { cart_id: cartId });

    return updated;
  },

  

  async removeItem(cartId: string, lineItemId: string): Promise<Cart> {
    const cart = CartService.get(cartId);

    const before = cart.items.length;
    cart.items = cart.items.filter((i) => i.id !== lineItemId);

    if (cart.items.length === before) {
      throw new ServiceError("ITEM_NOT_FOUND", `Line item ${lineItemId} not in cart`);
    }

    const updated = _recalc(cart);
    carts.set(cartId, updated);

    await eventBus.emit(EVENT.CART_UPDATED, { cart_id: cartId });

    return updated;
  },

  

  async updateQuantity(
    cartId: string,
    lineItemId: string,
    quantity: number,
  ): Promise<Cart> {
    if (quantity < 0) {
      throw new ServiceError("INVALID_QUANTITY", "Quantity cannot be negative");
    }

    const cart = CartService.get(cartId);

    if (quantity === 0) {
      return CartService.removeItem(cartId, lineItemId);
    }

    const line = cart.items.find((i) => i.id === lineItemId);
    if (!line) {
      throw new ServiceError("ITEM_NOT_FOUND", `Line item ${lineItemId} not in cart`);
    }

    // Stock check
    const variant = ProductModel.findVariant(line.product_id, line.variant_id);
    if (variant && variant.inventory_quantity < quantity) {
      throw new ServiceError(
        "INSUFFICIENT_STOCK",
        `Only ${variant.inventory_quantity} units available`,
      );
    }

    line.quantity = quantity;

    const updated = _recalc(cart);
    carts.set(cartId, updated);

    await eventBus.emit(EVENT.CART_UPDATED, { cart_id: cartId });

    return updated;
  },

  

  async applyDiscount(cartId: string, code: string): Promise<Cart> {
    const cart = CartService.get(cartId);

    const discount = DISCOUNT_CODES[code.toUpperCase()];
    if (!discount) {
      throw new ServiceError("INVALID_DISCOUNT", `Discount code "${code}" is not valid`);
    }

    if (cart.items.length === 0) {
      throw new ServiceError("EMPTY_CART", "Add items before applying a discount");
    }

    cart.discount_code = code.toUpperCase();

    const updated = _recalc(cart);
    carts.set(cartId, updated);

    await eventBus.emit(EVENT.CART_UPDATED, { cart_id: cartId });

    return updated;
  },

  

  async removeDiscount(cartId: string): Promise<Cart> {
    const cart = CartService.get(cartId);
    delete cart.discount_code;
    const updated = _recalc(cart);
    carts.set(cartId, updated);
    return updated;
  },

  

  async setEmail(cartId: string, email: string): Promise<Cart> {
    const cart = CartService.get(cartId);
    cart.email = email;
    cart.updated_at = new Date().toISOString();
    carts.set(cartId, cart);
    return cart;
  },

  

  async setShippingAddress(cartId: string, address: Address): Promise<Cart> {
    const cart = CartService.get(cartId);
    cart.shipping_address = address;
    cart.updated_at = new Date().toISOString();
    const updated = _recalc(cart);
    carts.set(cartId, updated);
    return updated;
  },

  

  async setBillingAddress(cartId: string, address: Address): Promise<Cart> {
    const cart = CartService.get(cartId);
    cart.billing_address = address;
    cart.updated_at = new Date().toISOString();
    carts.set(cartId, cart);
    return cart;
  },

  

  async complete(cartId: string): Promise<{ cart: Cart; order_id: string }> {
    const cart = CartService.get(cartId); // triggers validation

    
    if (!cart.email) {
      throw new ServiceError("MISSING_EMAIL", "Cart must have an email before completing");
    }
    if (!cart.shipping_address) {
      throw new ServiceError("MISSING_ADDRESS", "Cart must have a shipping address");
    }
    if (cart.items.length === 0) {
      throw new ServiceError("EMPTY_CART", "Cannot complete an empty cart");
    }

    // Final stock check — prices were already synced by get(), but verify
    // stock one more time at the moment of checkout.
    for (const item of cart.items) {
      const variant = ProductModel.findVariant(item.product_id, item.variant_id);
      if (!variant) {
        throw new ServiceError(
          "VARIANT_NOT_FOUND",
          `Variant "${item.variant_title}" is no longer available`,
        );
      }
      if (variant.inventory_quantity < item.quantity) {
        throw new ServiceError(
          "INSUFFICIENT_STOCK",
          `Only ${variant.inventory_quantity} units of "${item.variant_title}" available`,
        );
      }
    }

    
    await sleep(200);

    const orderId = generateId("ord");

    await eventBus.emit(EVENT.CART_COMPLETED, {
      cart_id:  cartId,
      order_id: orderId,
    });

    // Remove from active carts
    carts.delete(cartId);

    return { cart, order_id: orderId };
  },

  

  async clear(cartId: string): Promise<Cart> {
    const cart = CartService.get(cartId);
    cart.items           = [];
    cart.discount_code   = undefined;
    const updated        = _recalc(cart);
    carts.set(cartId, updated);
    return updated;
  },

  

  summary(cartId: string): {
    item_count: number;
    subtotal: number;
    discount_amount: number;
    shipping_total: number;
    tax_total: number;
    total: number;
  } {
    const cart = CartService.get(cartId);
    return {
      item_count:      cart.items.reduce((s, i) => s + i.quantity, 0),
      subtotal:        cart.subtotal,
      discount_amount: cart.discount_amount,
      shipping_total:  cart.shipping_total,
      tax_total:       cart.tax_total,
      total:           cart.total,
    };
  },
};



function _recalc(cart: Cart): Cart {
  
  const subtotal = cart.items.reduce((sum, item) => {
    const price = Number.isFinite(item.price) ? item.price : 0;
    return sum + (price * item.quantity);
  }, 0);
  
  let discountAmount = 0;
  if (cart.discount_code) {
    const rule = DISCOUNT_CODES[cart.discount_code];
    if (rule) {
      discountAmount = calcDiscount(subtotal, rule.type, rule.value);
    }
  }

  
  const shippingTotal =
    subtotal - discountAmount >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FLAT_RATE;

  const taxBase  = Math.max(0, subtotal - discountAmount);
  const taxTotal = calcTax(taxBase, TAX_RATE_PERCENT);

  
  const total = taxBase + shippingTotal + taxTotal;

  return {
    ...cart,
    subtotal,
    discount_amount: discountAmount,
    shipping_total:  shippingTotal,
    tax_total:       taxTotal,
    total,
    updated_at:      new Date().toISOString(),
  };
}

// ─── Cart Item Validation ──────────────────────────────────────────────────────
//
// Checks every item in the cart against live product/variant data:
//  1. Removes items whose product was deleted
//  2. Removes items whose variant was removed from the product
//  3. Syncs prices if the variant price changed
//  4. Caps quantity to current available stock
//  5. Updates product title / variant title / thumbnail if changed

function _validateCartItems(cart: Cart): { cart: Cart; changed: boolean } {
  let changed = false;
  const validItems: CartItem[] = [];

  for (const item of cart.items) {
    const product = ProductModel.findById(item.product_id);

    // Product was deleted or unpublished
    if (!product || product.status !== "published") {
      logger.warn("Cart item removed: product unavailable", {
        cartId: cart.id,
        productId: item.product_id,
        reason: !product ? "deleted" : "unpublished",
      });
      changed = true;
      continue;
    }

    const variant = product.variants.find((v) => v.id === item.variant_id);

    // Variant was removed from the product
    if (!variant) {
      logger.warn("Cart item removed: variant no longer exists", {
        cartId: cart.id,
        productId: item.product_id,
        variantId: item.variant_id,
      });
      changed = true;
      continue;
    }

    // Sync price if it changed
    if (item.price !== variant.price) {
      logger.info("Cart item price updated", {
        cartId: cart.id,
        variantId: item.variant_id,
        oldPrice: item.price,
        newPrice: variant.price,
      });
      item.price = variant.price;
      changed = true;
    }

    // Cap quantity to available stock
    if (variant.inventory_quantity <= 0) {
      logger.warn("Cart item removed: out of stock", {
        cartId: cart.id,
        variantId: item.variant_id,
      });
      changed = true;
      continue;
    }

    if (item.quantity > variant.inventory_quantity) {
      logger.warn("Cart item quantity capped to available stock", {
        cartId: cart.id,
        variantId: item.variant_id,
        was: item.quantity,
        now: variant.inventory_quantity,
      });
      item.quantity = variant.inventory_quantity;
      changed = true;
    }

    // Sync title / thumbnail if they changed
    if (item.title !== product.title) {
      item.title = product.title;
      changed = true;
    }
    if (item.variant_title !== variant.title) {
      item.variant_title = variant.title;
      changed = true;
    }
    if (item.thumbnail !== product.thumbnail) {
      item.thumbnail = product.thumbnail;
      changed = true;
    }

    validItems.push(item);
  }

  cart.items = validItems;
  return { cart, changed };
}

// ─── Reactive Cart Cleanup via Events ──────────────────────────────────────────
// When products are updated or deleted from the admin panel, proactively
// validate every active cart so users see correct data on their next request.

function _scrubAllCarts(): void {
  for (const [cartId, cart] of carts) {
    const { changed } = _validateCartItems(cart);
    if (changed) {
      carts.set(cartId, _recalc(cart));
    }
  }
}

eventBus.on(EVENT.PRODUCT_UPDATED, () => {
  _scrubAllCarts();
});

eventBus.on(EVENT.PRODUCT_DELETED, () => {
  _scrubAllCarts();
});