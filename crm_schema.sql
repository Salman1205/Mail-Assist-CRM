-- ============================================================
-- CRM Mail Assist - Complete Supabase Schema
-- ============================================================
-- Self-contained schema for CRM Mail Assist integration
-- Run this in Supabase SQL Editor (one-time setup)
-- ============================================================

-- ============================================================
-- PREREQUISITE: Helper function for updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================================
-- LEGACY TABLES (Required by existing code)
-- ============================================================

-- Tokens table (for Gmail OAuth - kept for compatibility)
CREATE TABLE IF NOT EXISTS public.tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT,
  token_type TEXT,
  scope TEXT,
  user_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_user_email ON public.tokens(user_email);

-- Emails table (legacy - for Gmail sync compatibility)
CREATE TABLE IF NOT EXISTS public.emails (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  subject TEXT,
  from_address TEXT,
  to_address TEXT,
  body TEXT,
  date TEXT,
  embedding DOUBLE PRECISION[],
  labels TEXT[],
  is_sent BOOLEAN NOT NULL DEFAULT true,
  is_reply BOOLEAN,
  user_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_emails_user_email ON public.emails(user_email);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON public.emails(thread_id);

-- Sync state table (legacy)
CREATE TABLE IF NOT EXISTS public.sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'idle',
  queued INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  user_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_state_user_email ON public.sync_state(user_email);

-- ============================================================
-- 1. USERS TABLE (Base table for team members)
-- ============================================================

-- Create user_role type if it doesn't exist
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'manager', 'agent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  role user_role NOT NULL DEFAULT 'agent',
  is_active BOOLEAN NOT NULL DEFAULT true,
  shared_gmail_email TEXT,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON public.users(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_user_email ON public.users(user_email);

-- ============================================================
-- 2. DEPARTMENTS TABLE (Workstream categories)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'folder',
  is_default BOOLEAN NOT NULL DEFAULT false,
  auto_assign_rules JSONB DEFAULT '[]',
  email_filters JSONB DEFAULT '[]',
  manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_name ON public.departments(name);
CREATE INDEX IF NOT EXISTS idx_departments_manager ON public.departments(manager_user_id);

DROP TRIGGER IF EXISTS update_departments_updated_at ON public.departments;
CREATE TRIGGER update_departments_updated_at 
BEFORE UPDATE ON public.departments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 3. TICKETS TABLE (Main ticket management)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT DEFAULT 'medium',
  assignee TEXT,
  assignee_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  last_customer_reply_at TIMESTAMPTZ,
  last_agent_reply_at TIMESTAMPTZ,
  user_email TEXT,
  crm_email_id TEXT,
  crm_client_id INTEGER,
  classification_confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_thread_id ON public.tickets(thread_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON public.tickets(assignee);
CREATE INDEX IF NOT EXISTS idx_tickets_user_email ON public.tickets(user_email);
CREATE INDEX IF NOT EXISTS idx_tickets_department_id ON public.tickets(department_id);
CREATE INDEX IF NOT EXISTS idx_tickets_crm_email_id ON public.tickets(crm_email_id);
CREATE INDEX IF NOT EXISTS idx_tickets_crm_client_id ON public.tickets(crm_client_id);
CREATE INDEX IF NOT EXISTS idx_tickets_last_customer_reply_at ON public.tickets(last_customer_reply_at);

DROP TRIGGER IF EXISTS update_tickets_updated_at ON public.tickets;
CREATE TRIGGER update_tickets_updated_at 
BEFORE UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. CRM EMAILS TABLE (Email metadata from MySQL CRM)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_emails (
  id TEXT PRIMARY KEY,
  client_id INTEGER,
  email_from TEXT NOT NULL,
  email_to TEXT,
  subject TEXT,
  snippet TEXT,
  content_hash TEXT,
  received_at TIMESTAMPTZ,
  type TEXT,
  department TEXT,
  arrears_status TEXT,
  assigned_to TEXT,
  assignment TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_emails_received_at ON public.crm_emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_emails_is_read ON public.crm_emails(is_read);
CREATE INDEX IF NOT EXISTS idx_crm_emails_department ON public.crm_emails(department);
CREATE INDEX IF NOT EXISTS idx_crm_emails_client_id ON public.crm_emails(client_id);

-- ============================================================
-- 5. NOTIFICATIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  reference_type TEXT,
  reference_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- ============================================================
-- 6. WORKSTREAMS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workstreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT DEFAULT 'normal',
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workstreams_status ON public.workstreams(status);
CREATE INDEX IF NOT EXISTS idx_workstreams_owner ON public.workstreams(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workstreams_department ON public.workstreams(department_id);

DROP TRIGGER IF EXISTS update_workstreams_updated_at ON public.workstreams;
CREATE TRIGGER update_workstreams_updated_at 
BEFORE UPDATE ON public.workstreams
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. TICKET NOTES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ticket_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_id ON public.ticket_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_user_id ON public.ticket_notes(user_id);

-- ============================================================
-- 8. TICKET VIEWS TABLE (Track user views)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ticket_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_views_user_ticket ON public.ticket_views(user_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_views_ticket ON public.ticket_views(ticket_id);

-- ============================================================
-- 9. QUICK REPLIES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_replies_category ON public.quick_replies(category);
CREATE INDEX IF NOT EXISTS idx_quick_replies_user_email ON public.quick_replies(user_email);

-- ============================================================
-- 10. GUARDRAILS TABLE (AI Configuration)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.guardrails (
  id INTEGER PRIMARY KEY DEFAULT 1,
  tone_style TEXT,
  rules TEXT,
  banned_words TEXT[] DEFAULT '{}',
  topic_rules JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.guardrails (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================================
-- 11. KNOWLEDGE ITEMS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  can_paraphrase BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_created ON public.knowledge_items(created_at DESC);

-- ============================================================
-- 12. CRM SYNC STATE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_sync_at TIMESTAMPTZ,
  last_sync_count INTEGER DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.crm_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 13. DEFAULT DEPARTMENTS
-- ============================================================

INSERT INTO public.departments (name, description, color, email_filters) VALUES
  ('General Enquiries', 'General customer inquiries', '#6366f1', '[]'),
  ('Complaints', 'Customer complaints and escalations', '#ef4444', '["complaint", "complaining", "dissatisfied", "unhappy"]'),
  ('Payments', 'Payment-related queries', '#22c55e', '["payment", "invoice", "receipt", "refund"]'),
  ('Technical Support', 'Technical issues and support', '#f59e0b', '["error", "not working", "issue", "problem"]'),
  ('Legal', 'Legal and compliance matters', '#8b5cf6', '["solicitor", "legal", "court", "claim"]')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 14. DEFAULT ADMIN USER
-- ============================================================

INSERT INTO public.users (name, email, role, is_active) 
VALUES ('Administrator', 'admin@theinsolvencygroup.com', 'admin', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 15. HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION mark_email_read(email_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.crm_emails 
  SET is_read = true, updated_at = NOW()
  WHERE id = email_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_unread_email_count()
RETURNS INTEGER AS $$
DECLARE
  count INTEGER;
BEGIN
  SELECT COUNT(*) INTO count
  FROM public.crm_emails
  WHERE is_read = false AND is_archived = false;
  RETURN count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS POLICIES FOR ADMIN ACCESS
-- ============================================================
-- Disable RLS on all tables for admin access (CRM mode)
-- In production, enable RLS with proper policies

ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.workstreams DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_views DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardrails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_sync_state DISABLE ROW LEVEL SECURITY;

-- Grant full access to authenticated and anon roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;




-- Fix all table permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Disable RLS on all tables
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS owner_email TEXT;


ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS user_email TEXT;



-- Add missing owner_email column to tickets
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- Grant ALL permissions to anon and authenticated roles
GRANT ALL ON public.tickets TO anon, authenticated;
GRANT ALL ON public.tokens TO anon, authenticated;
GRANT ALL ON public.sync_state TO anon, authenticated;
GRANT ALL ON public.emails TO anon, authenticated;
GRANT ALL ON public.users TO anon, authenticated;
GRANT ALL ON public.departments TO anon, authenticated;
GRANT ALL ON public.crm_emails TO anon, authenticated;
GRANT ALL ON public.notifications TO anon, authenticated;
GRANT ALL ON public.workstreams TO anon, authenticated;
GRANT ALL ON public.ticket_notes TO anon, authenticated;
GRANT ALL ON public.ticket_views TO anon, authenticated;
GRANT ALL ON public.quick_replies TO anon, authenticated;
GRANT ALL ON public.guardrails TO anon, authenticated;
GRANT ALL ON public.knowledge_items TO anon, authenticated;
GRANT ALL ON public.crm_sync_state TO anon, authenticated;

-- Grant sequence permissions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Disable RLS on all tables
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.workstreams DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_views DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardrails DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_sync_state DISABLE ROW LEVEL SECURITY;











-- ============================================================
-- FIX PERMISSIONS FOR CRM MAIL ASSIST
-- ============================================================
-- Run this in Supabase SQL Editor to fix "permission denied for table tickets" errors
-- This grants proper permissions to all roles
-- ============================================================

-- 1. Ensure all tables have RLS disabled (for CRM admin mode)
ALTER TABLE IF EXISTS public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.crm_emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sync_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.workstreams DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_views DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quick_replies DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.guardrails DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.knowledge_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.crm_sync_state DISABLE ROW LEVEL SECURITY;

-- 2. Grant ALL permissions on ALL tables to both anon and authenticated roles
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 3. Specifically grant permissions on tickets table (the error table)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- 4. Ensure default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;

-- 5. Check if service_role needs grants (usually has full access already)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Done! You should see "Command executed successfully" after running this.
-- No results will be returned, but the permissions will be applied.


GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;