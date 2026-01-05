-- Add unique constraint to tickets table to prevent duplicate thread_ids
-- We use COALESCE to treat NULL user_email as a distinct value '' for uniqueness purposes
-- OR we can just add a unique index on (thread_id, user_email).
-- Postgres unique constraint allows multiple NULLs in user_email by default.
-- Based on the duplicates we saw (user_email is NULL), we want to prevent multiple NULLs for the same thread_id.
-- So we should use a unique index with NULLS NOT DISTINCT (Postgres 15+) or a partial index.

-- Since we don't know the Postgres version, checking for duplicates where user_email IS NULL separately is safer.

-- Option 1: Unique index on thread_id where user_email IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS tickets_thread_id_idx_null_user ON tickets (thread_id) WHERE user_email IS NULL;

-- Option 2: Unique index on (thread_id, user_email) where user_email IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS tickets_thread_id_user_email_idx ON tickets (thread_id, user_email) WHERE user_email IS NOT NULL;

-- This covers both cases: global tickets (null user_email) are unique by thread_id,
-- and scoped tickets are unique by (thread_id, user_email).
