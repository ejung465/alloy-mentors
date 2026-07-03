-- ============================================================================
-- Alloy — Migration 0006: FIX infinite recursion in users RLS
--
-- Symptom: selecting from `users` returns 500 "stack depth limit exceeded"
-- (SQLSTATE 54001). Cause: helper functions used inside the `users` policies
-- themselves query `users`, which re-triggers the policy → infinite loop.
--
-- Fix: make the helpers SECURITY DEFINER so their internal query bypasses RLS.
-- Run this once (after 0001–0005). Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_leadership()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin','president','vp')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_create_events()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin','president','vp','director')
  )
$$;
