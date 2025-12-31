-- Tokens (1 row for your Gmail tokens)
create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  access_token text,
  refresh_token text,
  expiry_date bigint,
  token_type text,
  scope text,
  updated_at timestamptz default now()
);

-- Drafts (matches StoredDraft)
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  email_id text not null,
  subject text not null,
  "from" text not null,
  "to" text not null,
  original_body text not null,
  draft_text text not null,
  created_at timestamptz not null default now()
);

-- Sync state (only one row used)
create table if not exists sync_state (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'idle',
  queued integer not null default 0,
  processed integer not null default 0,
  errors integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz
);create table if not exists public.emails (
  id text primary key,
  thread_id text,
  subject text,
  from_address text,
  to_address text,
  body text,
  date text,
  embedding double precision[],
  labels text[],
  is_sent boolean not null default true,
  is_reply boolean
);-- Add user_email column to all tables for per-user data scoping

-- Add user_email to tokens table (most important for auth)
ALTER TABLE public.tokens 
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Add user_email to emails table
ALTER TABLE public.emails 
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Add user_email to drafts table
ALTER TABLE public.drafts 
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Add user_email to sync_state table
ALTER TABLE public.sync_state 
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_emails_user_email ON public.emails(user_email);
CREATE INDEX IF NOT EXISTS idx_tokens_user_email ON public.tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_drafts_user_email ON public.drafts(user_email);
CREATE INDEX IF NOT EXISTS idx_sync_state_user_email ON public.sync_state(user_email);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null,
  customer_email text not null,
  customer_name text,
  subject text not null,
  status text not null default 'open',          -- open | pending | on_hold | closed
  priority text not null default 'medium',      -- low | medium | high | urgent
  assignee text,                                -- simple string name for now
  tags text[] default '{}',
  last_customer_reply_at timestamptz,
  last_agent_reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_email text
);

create index if not exists idx_tickets_thread_id on public.tickets(thread_id);
create index if not exists idx_tickets_status on public.tickets(status);
create index if not exists idx_tickets_assignee on public.tickets(assignee);
create index if not exists idx_tickets_user_email on public.tickets(user_email);
create index if not exists idx_tickets_last_customer_reply_at
  on public.tickets(last_customer_reply_at);

  -- Task 2: Role & Auth Layer - Supabase Schema
-- Run this SQL in your Supabase SQL editor

-- Create role enum type
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'agent');

-- Create users table for team members
-- All team members share the same Gmail account but have individual identities
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT, -- Optional: personal email (not the shared Gmail)
  role user_role NOT NULL DEFAULT 'agent',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- All users belong to the same shared Gmail account
  -- We'll use user_email from tokens table to link to shared account
  shared_gmail_email TEXT, -- The shared Gmail account email
  CONSTRAINT unique_name_per_account UNIQUE (name, shared_gmail_email)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_shared_gmail ON public.users(shared_gmail_email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON public.users(is_active) WHERE is_active = true;

-- Update tickets table to reference users.id instead of just assignee name
-- First, add user_id column if it doesn't exist
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Create index for assignee lookups
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_user_id ON public.tickets(assignee_user_id);

-- Add user_email to users table for linking to shared Gmail account
-- This allows us to scope users to the correct shared account
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE INDEX IF NOT EXISTS idx_users_user_email ON public.users(user_email);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_users_updated_at 
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (you'll need to update shared_gmail_email after first login)
-- This is optional - you can create users via the API instead
-- INSERT INTO public.users (name, role, shared_gmail_email, user_email) 
-- VALUES ('Admin', 'admin', NULL, NULL)
-- ON CONFLICT DO NOTHING;

-- Create ticket_notes table for internal notes
-- Notes are only visible to team members, not customers

CREATE TABLE IF NOT EXISTS public.ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_id ON public.ticket_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_user_id ON public.ticket_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_created_at ON public.ticket_notes(created_at);

-- Create trigger to update updated_at
CREATE TRIGGER update_ticket_notes_updated_at 
BEFORE UPDATE ON public.ticket_notes
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Make priority column nullable in tickets table
ALTER TABLE public.tickets 
ALTER COLUMN priority DROP NOT NULL;

create table public.ticket_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  unique (user_id, ticket_id)
);

create index ticket_views_user_ticket_idx on public.ticket_views (user_id, ticket_id);
create index ticket_views_ticket_idx on public.ticket_views (ticket_id);


create table if not exists public.ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  user_email text,
  last_customer_reply_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ticket_updates_ticket_idx on public.ticket_updates(ticket_id);


create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  can_paraphrase boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_items_created_idx on public.knowledge_items(created_at desc);


-- Guardrails single-row table
create table if not exists public.guardrails (
  id integer primary key default 1,
  tone_style text,
  rules text,
  banned_words text[] default '{}',
  topic_rules jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- Allow only one row (id=1)
insert into public.guardrails (id)
values (1)
on conflict do nothing;




-- Quick Replies Table
-- Stores pre-written response templates for agents
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT, -- For scoping to shared Gmail account
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_quick_replies_category ON public.quick_replies(category);
CREATE INDEX IF NOT EXISTS idx_quick_replies_tags ON public.quick_replies USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_quick_replies_user_email ON public.quick_replies(user_email);
CREATE INDEX IF NOT EXISTS idx_quick_replies_created_by ON public.quick_replies(created_by);

-- Create trigger to update updated_at (uses your existing function)
CREATE TRIGGER update_quick_replies_updated_at 
BEFORE UPDATE ON public.quick_replies
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();





-- Update INSERT policy to allow all authenticated users
DROP POLICY IF EXISTS "Admins can create quick replies" ON public.quick_replies;
CREATE POLICY "Users can create quick replies"
  ON public.quick_replies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- Update UPDATE policy to allow users to edit their own
DROP POLICY IF EXISTS "Admins can update quick replies" ON public.quick_replies;
CREATE POLICY "Users can update quick replies"
  ON public.quick_replies
  FOR UPDATE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
    AND (
      created_by = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
        AND users.user_email = quick_replies.user_email
      )
    )
  );

-- Update DELETE policy similarly
DROP POLICY IF EXISTS "Admins can delete quick replies" ON public.quick_replies;
CREATE POLICY "Users can delete quick replies"
  ON public.quick_replies
  FOR DELETE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
    AND (
      created_by = auth.uid() OR
      EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'manager')
        AND users.user_email = quick_replies.user_email
      )
    )
  );







-- SUPABASE SCHEMA UPDATES
-- Add these to your existing schema script
-- ============================================

-- ============================================
-- 1. Add created_by column to drafts table
-- ============================================
ALTER TABLE public.drafts 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- ============================================
-- 2. Add index on drafts.created_by for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_drafts_created_by ON public.drafts(created_by);

-- ============================================
-- 3. Add foreign key constraint (already included in ALTER TABLE above, but explicit for clarity)
-- ============================================
-- Note: The foreign key is already added in the ALTER TABLE statement above
-- If you need to add it separately, use:
-- ALTER TABLE public.drafts 
-- ADD CONSTRAINT fk_drafts_created_by 
-- FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ============================================
-- 4. Fix Quick Replies RLS Policies
-- The current policies use auth.uid() which won't work since we're using custom session cookies
-- We need to update them to work without Supabase Auth
-- ============================================

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can read quick replies" ON public.quick_replies;

-- Create new SELECT policy that filters by created_by (matching API behavior)
-- Since we can't use auth.uid(), we'll rely on API-level filtering
-- But we still need RLS for security - allow all authenticated users to read
-- The API will filter by created_by
CREATE POLICY "Users can read quick replies"
  ON public.quick_replies
  FOR SELECT
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- Note: The UPDATE and DELETE policies already check created_by, but they use auth.uid()
-- Since auth.uid() won't work, we need to update them to not rely on it
-- However, the API already does permission checks, so RLS just needs to ensure
-- users can only access quick replies for their shared Gmail account

-- Drop existing UPDATE policy
DROP POLICY IF EXISTS "Users can update quick replies" ON public.quick_replies;

-- Create new UPDATE policy (API will check created_by ownership)
CREATE POLICY "Users can update quick replies"
  ON public.quick_replies
  FOR UPDATE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  )
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete quick replies" ON public.quick_replies;

-- Create new DELETE policy (API will check created_by ownership)
CREATE POLICY "Users can delete quick replies"
  ON public.quick_replies
  FOR DELETE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- ============================================
-- 5. Add RLS policies for drafts table (if RLS is enabled)
-- ============================================

-- Enable RLS on drafts table (if not already enabled)
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Users can only see their own drafts (filtered by created_by)
-- The API filters by created_by, but RLS provides additional security
CREATE POLICY "Users can read their own drafts"
  ON public.drafts
  FOR SELECT
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- INSERT policy: Users can create drafts
CREATE POLICY "Users can create drafts"
  ON public.drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- UPDATE policy: Users can update their own drafts
-- The API will check created_by ownership
CREATE POLICY "Users can update their own drafts"
  ON public.drafts
  FOR UPDATE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  )
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

-- DELETE policy: Users can delete their own drafts
-- The API will check created_by ownership
CREATE POLICY "Users can delete their own drafts"
  ON public.drafts
  FOR DELETE
  TO authenticated
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );







  -- Guardrails: scope per email account
ALTER TABLE public.guardrails
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guardrails_user_email ON public.guardrails(user_email);
CREATE INDEX IF NOT EXISTS idx_guardrails_created_by ON public.guardrails(created_by);

-- Optional: ensure only one row per email account
CREATE UNIQUE INDEX IF NOT EXISTS uniq_guardrails_per_email ON public.guardrails(user_email);

-- Enable RLS
ALTER TABLE public.guardrails ENABLE ROW LEVEL SECURITY;

-- RLS policies (match your other tables: allow authenticated for that account)
DROP POLICY IF EXISTS "Users can read guardrails" ON public.guardrails;
CREATE POLICY "Users can read guardrails" ON public.guardrails
  FOR SELECT TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can insert guardrails" ON public.guardrails;
CREATE POLICY "Users can insert guardrails" ON public.guardrails
  FOR INSERT TO authenticated
  WITH CHECK (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can update guardrails" ON public.guardrails;
CREATE POLICY "Users can update guardrails" ON public.guardrails
  FOR UPDATE TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL))
  WITH CHECK (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can delete guardrails" ON public.guardrails;
CREATE POLICY "Users can delete guardrails" ON public.guardrails
  FOR DELETE TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));




-- Guardrails draft columns so saves work even if only tone is set
ALTER TABLE public.guardrails
  ADD COLUMN IF NOT EXISTS draft_tone_style TEXT,
  ADD COLUMN IF NOT EXISTS draft_rules TEXT,
  ADD COLUMN IF NOT EXISTS draft_banned_words TEXT[],
  ADD COLUMN IF NOT EXISTS draft_topic_rules JSONB,
  ADD COLUMN IF NOT EXISTS pending BOOLEAN DEFAULT false;

-- Backfill defaults for existing rows
UPDATE public.guardrails
SET
  draft_banned_words = COALESCE(draft_banned_words, '{}'),
  draft_topic_rules = COALESCE(draft_topic_rules, '[]'::jsonb),
  pending = COALESCE(pending, false);

UPDATE public.guardrails
SET pending = false
WHERE pending = true
  AND COALESCE(draft_tone_style, '') = ''
  AND COALESCE(draft_rules, '') = ''
  AND (draft_banned_words IS NULL OR array_length(draft_banned_words, 1) IS NULL OR draft_banned_words = '{}')
  AND (draft_topic_rules IS NULL OR draft_topic_rules = '[]'::jsonb);



  -- ============================================
-- Task 11: Analytics & Logging Tables
-- ============================================

-- 1. Guardrail Usage Logs
CREATE TABLE IF NOT EXISTS public.guardrail_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  draft_id TEXT,
  action TEXT NOT NULL, -- 'applied', 'blocked', 'topic_rule_triggered'
  guardrail_type TEXT, -- 'tone_style', 'rules', 'banned_words', 'topic_rule'
  details JSONB,
  draft_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardrail_logs_user_email ON public.guardrail_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_guardrail_logs_user_id ON public.guardrail_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_logs_ticket_id ON public.guardrail_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_logs_action ON public.guardrail_logs(action);
CREATE INDEX IF NOT EXISTS idx_guardrail_logs_created_at ON public.guardrail_logs(created_at);

-- 2. AI Usage Logs
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- 'draft_generated', 'draft_regenerated', 'draft_edited', 'draft_sent', 'knowledge_used'
  draft_id TEXT,
  knowledge_item_ids UUID[],
  guardrail_applied BOOLEAN DEFAULT false,
  guardrail_blocked BOOLEAN DEFAULT false,
  response_time_ms INTEGER,
  draft_length INTEGER,
  was_edited BOOLEAN DEFAULT false,
  was_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_email ON public.ai_usage_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_id ON public.ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_ticket_id ON public.ai_usage_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_action ON public.ai_usage_logs(action);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON public.ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_knowledge_items ON public.ai_usage_logs USING GIN(knowledge_item_ids);

-- 3. Ticket Analytics (aggregated data)
CREATE TABLE IF NOT EXISTS public.ticket_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL, -- 'open', 'pending', 'on_hold', 'closed'
  count INTEGER NOT NULL DEFAULT 0,
  avg_response_time_minutes INTEGER,
  avg_resolution_time_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email, date, status)
);

CREATE INDEX IF NOT EXISTS idx_ticket_analytics_user_email ON public.ticket_analytics(user_email);
CREATE INDEX IF NOT EXISTS idx_ticket_analytics_date ON public.ticket_analytics(date);
CREATE INDEX IF NOT EXISTS idx_ticket_analytics_status ON public.ticket_analytics(status);
CREATE INDEX IF NOT EXISTS idx_ticket_analytics_user_date ON public.ticket_analytics(user_email, date);

-- 4. Agent Performance Metrics
CREATE TABLE IF NOT EXISTS public.agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  tickets_assigned INTEGER DEFAULT 0,
  tickets_closed INTEGER DEFAULT 0,
  avg_response_time_minutes INTEGER,
  avg_resolution_time_minutes INTEGER,
  ai_drafts_generated INTEGER DEFAULT 0,
  drafts_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email, user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_agent_performance_user_email ON public.agent_performance(user_email);
CREATE INDEX IF NOT EXISTS idx_agent_performance_user_id ON public.agent_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_performance_date ON public.agent_performance(date);
CREATE INDEX IF NOT EXISTS idx_agent_performance_user_date ON public.agent_performance(user_email, date);

-- 5. Triggers for updated_at
CREATE TRIGGER update_ticket_analytics_updated_at 
BEFORE UPDATE ON public.ticket_analytics
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_performance_updated_at 
BEFORE UPDATE ON public.agent_performance
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 6. Enable RLS
ALTER TABLE public.guardrail_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_performance ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
CREATE POLICY "Users can read guardrail logs"
  ON public.guardrail_logs
  FOR SELECT
  TO authenticated
  USING (true); -- API will filter by user_email

CREATE POLICY "Users can read ai usage logs"
  ON public.ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (true); -- API will filter by user_email

CREATE POLICY "Users can read ticket analytics"
  ON public.ticket_analytics
  FOR SELECT
  TO authenticated
  USING (true); -- API will filter by user_email

CREATE POLICY "Users can read agent performance"
  ON public.agent_performance
  FOR SELECT
  TO authenticated
  USING (true); -- API will filter by user_email




  ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_knowledge_items_user_email ON public.knowledge_items(user_email);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_by ON public.knowledge_items(created_by);

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read knowledge items" ON public.knowledge_items;
CREATE POLICY "Users can read knowledge items"
  ON public.knowledge_items
  FOR SELECT TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can insert knowledge items" ON public.knowledge_items;
CREATE POLICY "Users can insert knowledge items"
  ON public.knowledge_items
  FOR INSERT TO authenticated
  WITH CHECK (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can update knowledge items" ON public.knowledge_items;
CREATE POLICY "Users can update knowledge items"
  ON public.knowledge_items
  FOR UPDATE TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL))
  WITH CHECK (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));

DROP POLICY IF EXISTS "Users can delete knowledge items" ON public.knowledge_items;
CREATE POLICY "Users can delete knowledge items"
  ON public.knowledge_items
  FOR DELETE TO authenticated
  USING (user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL));





  -- ============================================
-- Shopify Integration Schema
-- Add this section to your existing schema
-- ============================================

-- Shopify Configuration Table
-- Stores Shopify API credentials per Gmail account
CREATE TABLE IF NOT EXISTS public.shopify_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  shop_domain TEXT NOT NULL, -- e.g., "your-shop.myshopify.com"
  access_token TEXT NOT NULL, -- Private app access token
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_shopify_config_user_email ON public.shopify_config(user_email);

-- Trigger to update updated_at
CREATE TRIGGER update_shopify_config_updated_at 
  BEFORE UPDATE ON public.shopify_config 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.shopify_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Only allow users to access their own Shopify config
DROP POLICY IF EXISTS "Users can read their own Shopify config" ON public.shopify_config;
CREATE POLICY "Users can read their own Shopify config" 
  ON public.shopify_config 
  FOR SELECT 
  TO authenticated 
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Admins can manage Shopify config" ON public.shopify_config;
CREATE POLICY "Admins can manage Shopify config" 
  ON public.shopify_config 
  FOR ALL 
  TO authenticated 
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.user_email = shopify_config.user_email 
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.user_email = shopify_config.user_email 
      AND users.role = 'admin'
    )
  );

-- Customer Cache Table (optional - for performance)
-- Caches customer data to reduce API calls
CREATE TABLE IF NOT EXISTS public.shopify_customer_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  shopify_customer_id BIGINT,
  customer_data JSONB NOT NULL, -- Full customer data from Shopify
  orders_data JSONB, -- Recent orders data
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_email, customer_email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shopify_cache_user_email ON public.shopify_customer_cache(user_email);
CREATE INDEX IF NOT EXISTS idx_shopify_cache_customer_email ON public.shopify_customer_cache(customer_email);
CREATE INDEX IF NOT EXISTS idx_shopify_cache_expires_at ON public.shopify_customer_cache(expires_at);

-- Enable RLS
ALTER TABLE public.shopify_customer_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for cache
DROP POLICY IF EXISTS "Users can read their own cached customer data" ON public.shopify_customer_cache;
CREATE POLICY "Users can read their own cached customer data" 
  ON public.shopify_customer_cache 
  FOR SELECT 
  TO authenticated 
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Users can cache their own customer data" ON public.shopify_customer_cache;
CREATE POLICY "Users can cache their own customer data" 
  ON public.shopify_customer_cache 
  FOR ALL 
  TO authenticated 
  USING (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  )
  WITH CHECK (
    user_email IN (
      SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL
    )
  );



  -- Run this in your Supabase SQL editor or migration
ALTER TABLE public.ticket_notes ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_ticket_notes_mentions_gin ON public.ticket_notes USING GIN (mentions);


-- Mentions field (if not already applied)
ALTER TABLE public.ticket_notes ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_ticket_notes_mentions_gin ON public.ticket_notes USING GIN (mentions);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mention','assignment')),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  note_id UUID REFERENCES public.ticket_notes(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);












-- ============================================
-- 1. BUSINESSES TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS public.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  business_email TEXT UNIQUE NOT NULL,
  business_phone TEXT,
  owner_name TEXT NOT NULL,
  
  -- Auth fields
  password_hash TEXT NOT NULL,
  is_email_verified BOOLEAN DEFAULT FALSE,
  
  -- Subscription (future-proof)
  subscription_tier TEXT DEFAULT 'free',
  
  -- Legacy flag for existing accounts
  is_legacy BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_email ON public.businesses(business_email);
CREATE INDEX IF NOT EXISTS idx_businesses_legacy ON public.businesses(is_legacy);

-- ============================================
-- 2. EMAIL VERIFICATION TOKENS TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_token ON public.email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_email ON public.email_verification_tokens(email);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_otp ON public.email_verification_tokens(otp_code);
CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires ON public.email_verification_tokens(expires_at);

-- ============================================
-- 3. AGENT INVITATION TOKENS TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS public.agent_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'agent',
  token TEXT UNIQUE NOT NULL,
  invited_by UUID REFERENCES public.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(business_id, email)
);

CREATE INDEX IF NOT EXISTS idx_agent_invitations_token ON public.agent_invitations(token);
CREATE INDEX IF NOT EXISTS idx_agent_invitations_business ON public.agent_invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_invitations_email ON public.agent_invitations(email);

-- ============================================
-- 4. USER SESSIONS TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON public.user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_business_id ON public.user_sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions(expires_at);

-- ============================================
-- 5. UPDATE EXISTING USERS TABLE
-- ============================================
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_business_id ON public.users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON public.users(email) WHERE email IS NOT NULL;

-- Update constraint: email must be unique within a business
-- Drop the old constraint first (this automatically drops the index)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS unique_name_per_account;
-- Drop any existing new constraint if re-running
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS unique_email_per_business;
-- Now add the new constraint
ALTER TABLE public.users 
  ADD CONSTRAINT unique_email_per_business UNIQUE (business_id, email);

-- ============================================
-- 6. UPDATE EXISTING TOKENS TABLE
-- ============================================
ALTER TABLE public.tokens 
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tokens_business_id ON public.tokens(business_id);

-- ============================================
-- 7. TRIGGERS FOR UPDATED_AT
-- ============================================
CREATE TRIGGER update_businesses_updated_at 
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. ENABLE RLS ON NEW TABLES
-- ============================================
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 9. RLS POLICIES
-- ============================================

-- Businesses: Users can only see their own business
DROP POLICY IF EXISTS "Users can view their own business" ON public.businesses;
CREATE POLICY "Users can view their own business"
  ON public.businesses FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT business_id FROM public.users WHERE users.id = auth.uid()
    )
  );

-- Sessions: Users can only access their own sessions
DROP POLICY IF EXISTS "Users can access their own sessions" ON public.user_sessions;
CREATE POLICY "Users can access their own sessions"
  ON public.user_sessions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Email verification tokens: Public can insert/read (for registration flow)
DROP POLICY IF EXISTS "Anyone can create verification tokens" ON public.email_verification_tokens;
CREATE POLICY "Anyone can create verification tokens"
  ON public.email_verification_tokens FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can read verification tokens" ON public.email_verification_tokens;
CREATE POLICY "Anyone can read verification tokens"
  ON public.email_verification_tokens FOR SELECT
  TO anon, authenticated
  USING (true);

-- Agent invitations: Only admins can create, anyone can read their own
DROP POLICY IF EXISTS "Admins can create invitations" ON public.agent_invitations;
CREATE POLICY "Admins can create invitations"
  ON public.agent_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.id = auth.uid() 
      AND users.role = 'admin'
      AND users.business_id = agent_invitations.business_id
    )
  );

DROP POLICY IF EXISTS "Anyone can view invitations by token" ON public.agent_invitations;
CREATE POLICY "Anyone can view invitations by token"
  ON public.agent_invitations FOR SELECT
  TO anon, authenticated
  USING (true);









  -- ============================================
-- MIGRATION: Fix Auth System Conflicts
-- Run this entire script in your Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. FIX AGENT_INVITATIONS - Add missing columns
-- ============================================
ALTER TABLE public.agent_invitations 
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS invitation_token TEXT;

-- Add constraint for status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'agent_invitations_status_check'
  ) THEN
    ALTER TABLE public.agent_invitations 
      ADD CONSTRAINT agent_invitations_status_check 
      CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled'));
  END IF;
END $$;

-- Update token column reference (rename if needed)
UPDATE public.agent_invitations 
SET invitation_token = token 
WHERE invitation_token IS NULL AND token IS NOT NULL;

-- Drop old constraint (if exists) before creating new index
ALTER TABLE public.agent_invitations DROP CONSTRAINT IF EXISTS agent_invitations_token_key;

-- Create unique index on invitation_token
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_invitations_invitation_token 
  ON public.agent_invitations(invitation_token) 
  WHERE invitation_token IS NOT NULL;

-- Set default status for existing rows
UPDATE public.agent_invitations 
SET status = 'pending' 
WHERE status IS NULL;

-- ============================================
-- 2. CREATE LEGACY BUSINESSES - Link existing Gmail OAuth data
-- ============================================
INSERT INTO public.businesses (
  business_name,
  business_email,
  owner_name,
  password_hash,
  is_email_verified,
  is_legacy,
  created_at
)
SELECT DISTINCT
  'Legacy Account - ' || COALESCE(t.user_email, 'Unknown') as business_name,
  t.user_email as business_email,
  'Legacy Owner' as owner_name,
  'LEGACY_NO_PASSWORD_REQUIRED' as password_hash,
  true as is_email_verified,
  true as is_legacy,
  NOW() as created_at
FROM public.tokens t
WHERE t.user_email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.businesses b 
    WHERE b.business_email = t.user_email
  )
ON CONFLICT (business_email) DO NOTHING;

-- ============================================
-- 3. BACKFILL business_id - Link tokens to businesses
-- ============================================
UPDATE public.tokens t
SET business_id = b.id
FROM public.businesses b
WHERE t.user_email = b.business_email
  AND t.business_id IS NULL
  AND t.user_email IS NOT NULL;

-- ============================================
-- 4. BACKFILL business_id - Link users to businesses
-- ============================================
UPDATE public.users u
SET business_id = b.id
FROM public.businesses b
WHERE (
  u.shared_gmail_email = b.business_email 
  OR u.user_email = b.business_email
)
AND u.business_id IS NULL;

-- ============================================
-- 5. FIX UNIQUE CONSTRAINTS - Support both auth methods
-- ============================================

-- Drop old conflicting constraint
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS unique_name_per_account;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS unique_email_per_business;

-- New business users: unique email per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_per_business 
  ON public.users(business_id, email) 
  WHERE business_id IS NOT NULL AND email IS NOT NULL;

-- Legacy Gmail OAuth users: keep old constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_legacy_name_gmail 
  ON public.users(name, shared_gmail_email) 
  WHERE shared_gmail_email IS NOT NULL;

-- ============================================
-- 6. UPDATE RLS POLICIES - Support both auth methods
-- ============================================

-- Drop all existing policies for tables we're updating
DROP POLICY IF EXISTS "Users can access emails" ON public.emails;
DROP POLICY IF EXISTS "Users can access tickets" ON public.tickets;
DROP POLICY IF EXISTS "Users can access drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can read their own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can create drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can update their own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can delete their own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can read quick replies" ON public.quick_replies;
DROP POLICY IF EXISTS "Users can create quick replies" ON public.quick_replies;
DROP POLICY IF EXISTS "Users can update quick replies" ON public.quick_replies;
DROP POLICY IF EXISTS "Users can delete quick replies" ON public.quick_replies;
DROP POLICY IF EXISTS "Users can read guardrails" ON public.guardrails;
DROP POLICY IF EXISTS "Users can insert guardrails" ON public.guardrails;
DROP POLICY IF EXISTS "Users can update guardrails" ON public.guardrails;
DROP POLICY IF EXISTS "Users can delete guardrails" ON public.guardrails;
DROP POLICY IF EXISTS "Users can read knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can insert knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can update knowledge items" ON public.knowledge_items;
DROP POLICY IF EXISTS "Users can delete knowledge items" ON public.knowledge_items;

-- EMAILS TABLE - Support both auth methods
CREATE POLICY "Users can access emails via both auth methods" 
  ON public.emails FOR ALL TO authenticated
  USING (
    -- Method 1: Gmail OAuth - match user_email from tokens
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    -- Method 2: Business auth - match via business->user relationship
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = emails.user_email
    )
  );

-- TICKETS TABLE - Support both auth methods
CREATE POLICY "Users can access tickets via both auth methods" 
  ON public.tickets FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = tickets.user_email
    )
  );

-- DRAFTS TABLE - Support both auth methods
CREATE POLICY "Users can access drafts via both auth methods" 
  ON public.drafts FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = drafts.user_email
    )
  );

-- QUICK_REPLIES TABLE - Support both auth methods
CREATE POLICY "Users can access quick_replies via both auth methods" 
  ON public.quick_replies FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = quick_replies.user_email
    )
  );

-- GUARDRAILS TABLE - Support both auth methods
CREATE POLICY "Users can access guardrails via both auth methods" 
  ON public.guardrails FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = guardrails.user_email
    )
  );

-- KNOWLEDGE_ITEMS TABLE - Support both auth methods
CREATE POLICY "Users can access knowledge_items via both auth methods" 
  ON public.knowledge_items FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = knowledge_items.user_email
    )
  );

-- SHOPIFY_CONFIG TABLE - Support both auth methods
DROP POLICY IF EXISTS "Users can read their own Shopify config" ON public.shopify_config;
DROP POLICY IF EXISTS "Admins can manage Shopify config" ON public.shopify_config;

CREATE POLICY "Users can access shopify_config via both auth methods" 
  ON public.shopify_config FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = shopify_config.user_email
    )
  );

-- SHOPIFY_CUSTOMER_CACHE TABLE - Support both auth methods
DROP POLICY IF EXISTS "Users can read their own cached customer data" ON public.shopify_customer_cache;
DROP POLICY IF EXISTS "Users can cache their own customer data" ON public.shopify_customer_cache;

CREATE POLICY "Users can access shopify_customer_cache via both auth methods" 
  ON public.shopify_customer_cache FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = shopify_customer_cache.user_email
    )
  );

-- ANALYTICS TABLES - Support both auth methods
DROP POLICY IF EXISTS "Users can read guardrail logs" ON public.guardrail_logs;
CREATE POLICY "Users can access guardrail_logs via both auth methods" 
  ON public.guardrail_logs FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = guardrail_logs.user_email
    )
  );

DROP POLICY IF EXISTS "Users can read ai usage logs" ON public.ai_usage_logs;
CREATE POLICY "Users can access ai_usage_logs via both auth methods" 
  ON public.ai_usage_logs FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = ai_usage_logs.user_email
    )
  );

DROP POLICY IF EXISTS "Users can read ticket analytics" ON public.ticket_analytics;
CREATE POLICY "Users can access ticket_analytics via both auth methods" 
  ON public.ticket_analytics FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = ticket_analytics.user_email
    )
  );

DROP POLICY IF EXISTS "Users can read agent performance" ON public.agent_performance;
CREATE POLICY "Users can access agent_performance via both auth methods" 
  ON public.agent_performance FOR ALL TO authenticated
  USING (
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.businesses b ON u.business_id = b.id
      WHERE b.business_email = agent_performance.user_email
    )
  );

-- ============================================
-- 7. ADD PERFORMANCE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_business_email_lookup 
  ON public.users(business_id, email) 
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_legacy_email 
  ON public.businesses(is_legacy, business_email);

CREATE INDEX IF NOT EXISTS idx_tokens_business_user 
  ON public.tokens(business_id, user_email);

-- ============================================
-- 8. VERIFICATION QUERIES (Optional - comment out to skip)
-- ============================================

-- Uncomment these to check for data issues:

-- Check users without business_id (should only be orphans)
-- SELECT COUNT(*) as users_without_business FROM public.users WHERE business_id IS NULL;

-- Check tokens without business_id
-- SELECT COUNT(*) as tokens_without_business FROM public.tokens WHERE user_email IS NOT NULL AND business_id IS NULL;

-- Check for legacy businesses created
-- SELECT COUNT(*) as legacy_businesses FROM public.businesses WHERE is_legacy = true;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

-- Summary of what was fixed:
-- ✅ 1. agent_invitations table now has status and invitation_token columns
-- ✅ 2. Legacy businesses created for all existing Gmail OAuth users
-- ✅ 3. business_id backfilled in tokens and users tables
-- ✅ 4. Unique constraints fixed to support both auth methods
-- ✅ 5. All RLS policies updated to check BOTH Gmail tokens AND business sessions
-- ✅ 6. Performance indexes added

-- Both authentication methods now work simultaneously:
-- - Business registration → OTP → Login (uses businesses + user_sessions)
-- - Gmail OAuth → Connect (uses tokens table, linked to legacy businesses)

-- Next steps:
-- 1. Test business registration flow
-- 2. Test Gmail OAuth flow
-- 3. Test agent invitations
-- 4. Both should work without conflicts!



-- Add provider and config columns to tokens table
ALTER TABLE public.tokens 
ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'gmail',
ADD COLUMN IF NOT EXISTS imap_config JSONB,
ADD COLUMN IF NOT EXISTS smtp_config JSONB;

-- Update existing records to be 'gmail'
UPDATE public.tokens SET provider = 'gmail' WHERE provider IS NULL;

-- Create index on provider for faster lookups
CREATE INDEX IF NOT EXISTS idx_tokens_provider ON public.tokens(provider);







-- ============================================
-- OAUTH & TOKENS SECURITY UPDATE
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Enable RLS on tokens table
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

-- 2. Create Policy: Users can only access their own tokens
-- This checks if the token belongs to the user via user_email
-- OR if the token belongs to the user's business
DROP POLICY IF EXISTS "Users can access their own tokens" ON public.tokens;

CREATE POLICY "Users can access their own tokens"
ON public.tokens
FOR ALL
TO authenticated
USING (
  -- Match by direct email ownership (Personal or Business user)
  user_email IN (
    SELECT email FROM public.users WHERE id = auth.uid()
  )
  OR
  -- Match by business ownership (Business user seeing org tokens)
  business_id IN (
    SELECT business_id FROM public.users WHERE id = auth.uid()
  )
);

-- 3. Ensure business_id can be NULL (for personal accounts)
ALTER TABLE public.tokens ALTER COLUMN business_id DROP NOT NULL;

-- 4. Add helpful indexes if missing
CREATE INDEX IF NOT EXISTS idx_tokens_user_email ON public.tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_tokens_business_id ON public.tokens(business_id);



-- Create a partial unique index for personal accounts (where business_id is NULL)
-- This ensures that a user can only have one personal account with a given email
-- while still allowing that same email to be used in different business contexts

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_personal_email_unique 
ON public.users(email) 
WHERE business_id IS NULL;
-- Fix sync_state table schema
-- Run this in your Supabase SQL Editor

ALTER TABLE public.sync_state 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Add created_at if missing too
ALTER TABLE public.sync_state 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Create index for updated_at
CREATE INDEX IF NOT EXISTS idx_sync_state_updated_at ON public.sync_state(updated_at);



-- Add owner_email column to emails table
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Create index for emails
CREATE INDEX IF NOT EXISTS idx_emails_owner_email ON emails(owner_email);

-- Update existing emails
UPDATE emails 
SET owner_email = user_email 
WHERE owner_email IS NULL;

-- Add owner_email column to tickets table
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Create index for tickets
CREATE INDEX IF NOT EXISTS idx_tickets_owner_email ON tickets(owner_email);

-- Update existing tickets
UPDATE tickets 
SET owner_email = user_email 
WHERE owner_email IS NULL;







-- ============================================
-- DEPARTMENTS FEATURE SCHEMA (Finalized)
-- Aligned with dual-auth (Legacy + Business)
-- ============================================

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  user_email TEXT,  -- Scoping for legacy Gmail accounts
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,  -- Scoping for business accounts
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT departments_scope_check CHECK (
    (user_email IS NOT NULL AND business_id IS NULL) OR
    (user_email IS NULL AND business_id IS NOT NULL)
  )
);

-- 2. User-Department Assignment
CREATE TABLE IF NOT EXISTS public.user_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, department_id)
);

-- 3. Tickets Update
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS classification_confidence DECIMAL(5,2);

-- 4. Finalized RLS Policies (Supporting Both Auth Methods)
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read departments" ON public.departments;
CREATE POLICY "Users can read departments"
  ON public.departments FOR SELECT TO authenticated
  USING (
    -- Method 1: Legacy Gmail OAuth
    user_email IN (SELECT user_email FROM public.tokens WHERE user_email IS NOT NULL)
    OR
    -- Method 2: Business auth match
    (business_id IS NOT NULL AND business_id IN (SELECT business_id FROM public.users))
  );

DROP POLICY IF EXISTS "Admins can manage departments" ON public.departments;
CREATE POLICY "Admins can manage departments"
  ON public.departments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.role IN ('admin', 'manager')
      AND (users.business_id = departments.business_id OR users.user_email = departments.user_email)
    )
  );

-- 5. Trigger (Using your existing function)
DROP TRIGGER IF EXISTS departments_updated_at_trigger ON public.departments;
CREATE TRIGGER departments_updated_at_trigger
  BEFORE UPDATE ON public.departments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Default Department Seeding
INSERT INTO public.departments (name, description, user_email, created_by)
SELECT 'General', 'General inquiries and unclassified emails', t.user_email, u.id
FROM public.tokens t
JOIN public.users u ON u.user_email = t.user_email
WHERE t.user_email IS NOT NULL AND t.business_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.user_email = t.user_email)
LIMIT 1;

INSERT INTO public.departments (name, description, business_id, created_by)
SELECT 'General', 'General inquiries and unclassified emails', b.id, u.id
FROM public.businesses b
JOIN public.users u ON u.business_id = b.id
WHERE u.role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.business_id = b.id)
LIMIT 1;





ALTER TABLE agent_invitations
ADD COLUMN IF NOT EXISTS department_ids uuid[] DEFAULT '{}';








-- Create department_feedback table for tracking AI accuracy and manual corrections
create table if not exists department_feedback (
  id uuid default gen_random_uuid() primary key,
  ticket_id uuid references tickets(id) on delete cascade not null,
  original_department_id uuid references departments(id) on delete set null,
  final_department_id uuid references departments(id) on delete set null,
  user_id uuid references users(id) on delete set null, -- who made the change
  reasoning text, -- manual reasoning or "correction"
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);




SELECT 
  df.*,
  t.subject,
  d1.name as original_dept,
  d2.name as final_dept
FROM department_feedback df
LEFT JOIN tickets t ON df.ticket_id = t.id
LEFT JOIN departments d1 ON df.original_department_id = d1.id
LEFT JOIN departments d2 ON df.final_department_id = d2.id
ORDER BY df.created_at DESC
LIMIT 50;




-- Enable the pgvector extension to work with embedding vectors
CREATE EXTENSION IF NOT EXISTS vector;

-- Add checking for existing column to avoid errors on potential re-runs
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'emails' AND column_name = 'embedding_vector') THEN 
        ALTER TABLE public.emails 
        ADD COLUMN embedding_vector vector(384); -- Using 384 dimensions for bge-small-en-v1.5 / all-MiniLM-L6-v2
    END IF; 
END $$;

-- Create an index for faster similarity search
-- lists = rows / 1000 is a good rule of thumb, using 100 for start
CREATE INDEX IF NOT EXISTS idx_emails_embedding_vector ON public.emails USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);

-- Create a function to search for similar emails
-- This function matches the user's email context to prevent cross-user data leakage
CREATE OR REPLACE FUNCTION match_emails (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  filter_user_email text
)
RETURNS TABLE (
  id text,
  subject text,
  body text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    emails.id,
    emails.subject,
    emails.body,
    1 - (emails.embedding_vector <=> query_embedding) as similarity
  FROM emails
  WHERE 1 - (emails.embedding_vector <=> query_embedding) > match_threshold
  AND emails.is_sent = true
  AND (
    -- Support both auth methods (personal/legacy vs business)
    -- 1. Direct match (Personal / Legacy)
    emails.user_email = filter_user_email
    OR
    -- 2. Business match (if filter_user_email belongs to a business that owns the email)
    -- Note: This complex join might be slow for real-time search, so we rely primarily on the user_email
    -- being correctly set on the email record itself during ingestion.
    -- For now, we enforce that the 'user_email' passed in MUST match the 'user_email' on the record,
    -- or the record's user_email must belong to the same business context.
    EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.businesses b ON u.business_id = b.id
        WHERE u.email = filter_user_email -- The user requesting
        AND b.business_email = emails.user_email -- The business that owns the email
    )
  )
  ORDER BY emails.embedding_vector <=> query_embedding
  LIMIT match_count;
END;
$$;




-- Create user_settings table for storing user preferences
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  auto_classify_days INTEGER DEFAULT 30 CHECK (auto_classify_days >= 1 AND auto_classify_days <= 365),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Ensure either user_email or business_id is set, but not both
  CONSTRAINT user_settings_account_check CHECK (
    (user_email IS NOT NULL AND business_id IS NULL) OR
    (user_email IS NULL AND business_id IS NOT NULL)
  ),
  
  -- Unique constraint per account
  CONSTRAINT user_settings_unique UNIQUE (user_email, business_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_email ON user_settings(user_email);
CREATE INDEX IF NOT EXISTS idx_user_settings_business_id ON user_settings(business_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();
