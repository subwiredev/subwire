-- Pins removed from the protocol. Drop the per-signal pinned flag; TTL expiry
-- and bootstrap ranking no longer special-case it.
ALTER TABLE signals DROP COLUMN IF EXISTS pinned;
