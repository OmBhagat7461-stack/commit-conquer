import { type Product, type PaginatedResponse } from "../../core/types";
import { paginate, stripEmpty } from "../../core/utils";
import { eventBus, EVENT } from "../../core/event-bus";
import { logger } from "../../core/logger";
import { Cache } from "../../core/cache";
import { ProductModel } from "./product.model";


// ─── Cache Setup ──────────────────────────────────────────────────────────────
//
// Three separate caches, each tuned to the volatility of its data:
//
//  • productById    – individual product lookups; 5-minute TTL.
//                     Invalidated on update / delete of that product.
//
//  • listResults    – paginated + filtered product lists; 2-minute TTL.
//                     Invalidated entirely on any write (create/update/delete),
//                     because a change to any product may affect any list page.
//
//  • categoryList   – category enumeration; 5-minute TTL.
//                     Invalidated when a product's category changes.
//
// Keys:
//   productById  → product_id  or  "handle:<handle>"
//   listResults  → JSON.stringify of the normalised ListProductsInput
//   categoryList → "all"

const productCache   = new Cache<Product>({ ttl: 5 * 60 * 1000, name: "productById",  sweepIntervalMs: 60_000 });
const listCache      = new Cache<PaginatedResponse<Product>>({ ttl: 2 * 60 * 1000, name: "productList",   sweepIntervalMs: 30_000 });
const categoryCache  = new Cache<string[]>({ ttl: 5 * 60 * 1000, name: "categoryList", sweepIntervalMs: 60_000 });

/** Build a stable, deterministic cache key from list inputs. */
function _listKey(input: ListProductsInput): string {
  return JSON.stringify({
    offset:   input.offset   ?? 0,
    limit:    input.limit    ?? 12,
    status:   input.status   ?? "published",
    category: input.category ?? "",
    search:   input.search   ?? "",
    sort:     input.sort     ?? "newest",
  });
}

/** Drop every cached list page and the category list — called on any mutation. */
function _invalidateWriteCaches(): void {
  listCache.clear();
  categoryCache.clear();
}



export interface ListProductsInput {
  offset?: number;
  limit?: number;
  status?: "published" | "draft" | "archived" | "all";
  category?: string;
  search?: string;
  sort?: "newest" | "oldest" | "price_asc" | "price_desc" | "title_asc";
}

export interface CreateProductInput {
  title: string;
  description?: string;
  thumbnail?: string;
  images?: string[];
  category?: string;
  tags?: string[];
  status?: "published" | "draft";
  variants: Array<{
    title: string;
    sku: string;
    price: number; // cents
    inventory_quantity: number;
    options: Record<string, string>;
  }>;
}

export interface UpdateProductInput {
  title?: string;
  description?: string;
  thumbnail?: string;
  images?: string[];
  category?: string;
  tags?: string[];
  status?: "published" | "draft" | "archived";
}

export const ProductService = {
  list(input: ListProductsInput = {}): PaginatedResponse<Product> {
    const key    = _listKey(input);
    const cached = listCache.get(key);
    if (cached) {
      logger.info("Cache hit: product list", { key });
      return cached;
    }

    const {
      offset = 0,
      limit = 12,
      status = "published",
      category,
      search,
      sort = "newest",
    } = input;

    let products = ProductModel.findAll();

    if (status !== "all") {
      products = products.filter((p) => p.status === status);
    }

    if (category && category !== "all") {
      products = products.filter((p) => p.category === category);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      products = products.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.category?.toLowerCase().includes(q),
      );
    }

    products = _sort(products, sort);


    const result = paginate(products, offset, limit);
    listCache.set(key, result);
    return result;
  },

  getById(id: string): Product {
    const cached = productCache.get(id);
    if (cached) {
      logger.info("Cache hit: product by id", { id });
      return cached;
    }

    const product = ProductModel.findById(id);
    if (!product) throw new ServiceError("PRODUCT_NOT_FOUND", `Product ${id} not found`);

    productCache.set(id, product);
    return product;
  },

  getByHandle(handle: string): Product {
    const cacheKey = `handle:${handle}`;
    const cached   = productCache.get(cacheKey);
    if (cached) {
      logger.info("Cache hit: product by handle", { handle });
      return cached;
    }

    const product = ProductModel.findByHandle(handle);
    if (!product) {
      throw new ServiceError(
        "PRODUCT_NOT_FOUND",
        `Product with handle "${handle}" not found`,
      );
    }

    productCache.set(cacheKey, product);
    return product;
  },

  async create(input: CreateProductInput): Promise<Product> {
    _validateCreate(input);

    const product = ProductModel.create({
      title: input.title,
      description: input.description ?? "",
      thumbnail: input.thumbnail ?? "",
      images: input.images ?? [],
      status: input.status ?? "draft",
      category: input.category ?? "",
      tags: input.tags ?? [],
      variants: input.variants.map((v) => ({
        id: `var_${Math.random().toString(36).slice(2, 9)}`,
        title: v.title,
        sku: v.sku,
        price: v.price,
        inventory_quantity: v.inventory_quantity,
        options: v.options,
      })),
    });

    // New product → invalidate list / category caches
    _invalidateWriteCaches();

    await eventBus.emit(EVENT.PRODUCT_CREATED, {
      product_id: product.id,
      title: product.title,
    });

    return product;
  },

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    ProductService.getById(id);

    const changes = stripEmpty(
      input as Record<string, unknown>,
    ) as Partial<Product>;
    const updated = ProductModel.update(id, changes);

    if (!updated) {
      throw new ServiceError("UPDATE_FAILED", `Failed to update product ${id}`);
    }

    // Evict the specific product entries + all list / category pages
    productCache.delete(id);
    productCache.delete(`handle:${updated.handle}`);
    _invalidateWriteCaches();

    await eventBus.emit(EVENT.PRODUCT_UPDATED, {
      product_id: id,
      changes: changes as Record<string, unknown>,
    });
    return updated;
  },

  async delete(id: string): Promise<{ deleted: string }> {
    const product = ProductService.getById(id);   // throws if not found

    const ok = ProductModel.delete(id);
    if (!ok)
      throw new ServiceError("DELETE_FAILED", `Failed to delete product ${id}`);

    // Evict the specific product entries + all list / category pages
    productCache.delete(id);
    productCache.delete(`handle:${product.handle}`);
    _invalidateWriteCaches();

    await eventBus.emit(EVENT.PRODUCT_DELETED, { product_id: id });

    return { deleted: id };
  },

  async bulkDelete(
    ids: string[],
  ): Promise<{ deleted: string[]; failed: string[] }> {
    const deleted: string[] = [];
    const failed: string[] = [];

    for (const id of ids) {
      try {
        await ProductService.delete(id);
        deleted.push(id);
      } catch {
        failed.push(id);
      }
    }

    return { deleted, failed };
  },

  async publish(id: string): Promise<Product> {
    const updated = await ProductService.update(id, { status: "published" });

    await eventBus.emit(EVENT.PRODUCT_PUBLISHED, { product_id: id });

    return updated;
  },

  async unpublish(id: string): Promise<Product> {
    return ProductService.update(id, { status: "draft" });
  },

  async adjustInventory(
    productId: string,
    variantId: string,
    delta: number,
  ): Promise<void> {
    const variant = ProductModel.updateVariantInventory(
      productId,
      variantId,
      delta,
    );

    if (!variant) {
      throw new ServiceError(
        "VARIANT_NOT_FOUND",
        `Variant ${variantId} not found on product ${productId}`,
      );
    }

    // Inventory change mutates the product object — evict so stale data
    // isn't served from the per-product cache.
    productCache.delete(productId);
    // Note: we intentionally do NOT clear listCache here — inventory_quantity
    // is not part of list filtering/sorting, so list pages remain valid.

    const qty = variant.inventory_quantity;

    await eventBus.emit(EVENT.INVENTORY_UPDATED, {
      variant_id: variantId,
      quantity: qty,
    });

    if (qty > 0 && qty <= 5) {
      await eventBus.emit(EVENT.INVENTORY_LOW, {
        variant_id: variantId,
        quantity: qty,
        threshold: 5,
      });
    }

    // Emit out-of-stock
    if (qty === 0) {
      await eventBus.emit(EVENT.INVENTORY_OUT, { variant_id: variantId });
    }
  },

  stats() {
    return ProductModel.stats();
  },

  categories(): string[] {
    const cached = categoryCache.get("all");
    if (cached) {
      logger.info("Cache hit: categories");
      return cached;
    }

    const all = ProductModel.findAll();
    const set = new Set(all.map((p) => p.category).filter(Boolean) as string[]);
    const result = [...set].sort();

    categoryCache.set("all", result);
    return result;
  },

  // ─── Cache Inspection (for /health or /admin/stats) ──────────────────────

  cacheStats() {
    return {
      products: productCache.size,
      lists:    listCache.size,
      categories: categoryCache.size,
    };
  },
};

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

function _sort(
  products: Product[],
  sort: ListProductsInput["sort"],
): Product[] {
  return [...products].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

      case "price_asc": {
        const aMin = Math.min(...a.variants.map((v) => v.price));
        const bMin = Math.min(...b.variants.map((v) => v.price));
        return aMin - bMin;
      }

      case "price_desc": {
        const aMin = Math.min(...a.variants.map((v) => v.price));
        const bMin = Math.min(...b.variants.map((v) => v.price));
        return bMin - aMin;
      }

      case "title_asc":
        return a.title.localeCompare(b.title);

      case "newest":
      default:
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }
  });
}

function _validateCreate(input: CreateProductInput): void {
  if (!input.title?.trim()) {
    throw new ServiceError("VALIDATION_ERROR", "Product title is required");
  }
  if (!input.variants || input.variants.length === 0) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      "At least one variant is required",
    );
  }
  for (const v of input.variants) {
    if (!v.sku?.trim()) {
      throw new ServiceError("VALIDATION_ERROR", `Variant SKU is required`);
    }
    if (typeof v.price !== "number" || v.price < 0) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        `Variant price must be a non-negative number`,
      );
    }
  }
}
