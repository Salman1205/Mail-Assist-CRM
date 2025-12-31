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
