import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowToCatalogProduct } from "./product-mapper.js";

describe("catalog sellerTrust from weighted profile", () => {
  it("maps users.rating_score / rating_count into sellerTrust + UNRATED under 5", () => {
    const p = rowToCatalogProduct({
      id: "sku-1",
      title: "Test tee",
      category: "fashion",
      seller_handle: "nairobi_kicks",
      seller_user_verified: true,
      seller_rating_score: 4.8,
      seller_rating_count: 3,
      seller_badge_tier: "newbie",
      seller_completed_orders: 3,
      seller_sales_count: 3,
      seller_avg_rating: 4.9,
      seller_total_reviews: 3,
      price_kes: 1200,
      in_stock: true,
      is_sold: false,
      tags: [],
    });
    assert.equal(p.sellerHandle, "nairobi_kicks");
    assert.equal(p.sellerTrust.unrated, true);
    assert.equal(p.sellerTrust.displayLabel, "UNRATED");
    assert.equal(p.sellerTrust.totalReviews, 3);
    assert.equal(p.rating, 0);
    assert.equal(p.reviews, 3);
    assert.ok(p.sellerTrust.badges.some((b) => b.id === "newbie"));
    assert.ok(p.sellerTrust.badges.some((b) => b.id === "verified_store"));
    assert.equal(p.isVerifiedStore, true);
  });

  it("shows public stars after 5+ weighted reviews and Top Rated when earned", () => {
    const p = rowToCatalogProduct({
      id: "sku-2",
      title: "Jacket",
      category: "fashion",
      seller_handle: "nairobi_kicks",
      seller_user_verified: true,
      seller_rating_score: 4.85,
      seller_rating_count: 42,
      seller_badge_tier: "top_rated",
      seller_completed_orders: 68,
      seller_sales_count: 68,
      seller_dispute_count: 0,
      seller_unresolved_disputes: 0,
      price_kes: 3500,
      in_stock: true,
      is_sold: false,
      tags: [],
    });
    assert.equal(p.sellerTrust.unrated, false);
    assert.equal(p.sellerTrust.avgRating, 4.85);
    assert.equal(p.sellerTrust.displayLabel, "4.8");
    assert.equal(p.rating, 4.85);
    assert.equal(p.reviews, 42);
    assert.equal(p.sellerTrust.badgeTier, "top_rated");
    assert.ok(p.sellerTrust.badges.some((b) => b.id === "top_rated"));
  });

  it("falls back to order_reviews when weighted count is empty", () => {
    const p = rowToCatalogProduct({
      id: "sku-3",
      title: "Bag",
      category: "fashion",
      seller_handle: "coast_thrift",
      seller_rating_count: 0,
      seller_rating_score: 5,
      seller_avg_rating: 4.2,
      seller_total_reviews: 12,
      seller_sales_count: 12,
      seller_completed_orders: 0,
      price_kes: 800,
      in_stock: true,
      is_sold: false,
      tags: [],
    });
    assert.equal(p.sellerTrust.totalReviews, 12);
    assert.equal(p.sellerTrust.unrated, false);
    assert.equal(p.sellerTrust.avgRating, 4.2);
    assert.equal(p.reviews, 12);
  });
});
