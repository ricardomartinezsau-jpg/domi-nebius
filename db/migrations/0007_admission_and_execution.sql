-- Additive only. Legacy runs deliberately remain unowned and inaccessible publicly.
CREATE TABLE admission_counters (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (bucket_key, window_start)
);
ALTER TABLE runs
  ADD COLUMN guest_owner TEXT,
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN request_hash TEXT,
  ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (dispatch_state IN ('idle', 'sending', 'accepted', 'unknown', 'rejected')),
  ADD COLUMN dispatch_started_at TIMESTAMPTZ,
  ADD COLUMN correlation_id TEXT;
CREATE UNIQUE INDEX runs_guest_idempotency ON runs (guest_owner, idempotency_key)
  WHERE guest_owner IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX runs_guest_active ON runs (guest_owner, status) WHERE guest_owner IS NOT NULL;
ALTER TABLE run_steps ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
