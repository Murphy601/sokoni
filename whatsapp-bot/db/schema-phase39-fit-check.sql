-- Phase 39: photos on reviews, for the post-sale fit check.
--
-- A fit check is an ordinary buyer_to_seller review that happens to carry a
-- picture, so it lives on order_reviews rather than in a table of its own --
-- it should count towards a seller's rating like any other review, and a
-- separate table would mean every reader had to remember to union it.
--
-- order_id stays nullable (phase 11 dropped the NOT NULL) because live prepaid
-- orders are SKN-* strings in JSON, matched by order_ref.

ALTER TABLE order_reviews
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  -- Marks a review created from a delivered, paid order rather than typed
  -- freely. That is the whole meaning of the "verified" badge, so it is a
  -- column the writer sets deliberately and not an inference.
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Storefronts show photo reviews first; without this that is a full scan of
-- every review a seller has ever had.
CREATE INDEX IF NOT EXISTS idx_order_reviews_with_photo
  ON order_reviews (seller_user_id, created_at DESC)
  WHERE photo_url IS NOT NULL;

INSERT INTO schema_migrations (name)
VALUES ('phase39_fit_check')
ON CONFLICT (name) DO NOTHING;
