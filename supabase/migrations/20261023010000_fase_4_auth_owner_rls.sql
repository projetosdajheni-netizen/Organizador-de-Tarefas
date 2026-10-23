-- Phase 4: bind all persisted rows to a Supabase Auth user.
-- Legacy rows stay unowned until the authenticated one-time claim migrates them.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sync_spaces','tasks','habits','habit_completions','focus_sessions','library_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_delete ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id)', t);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS tasks_owner_id_idx ON public.tasks(owner_id);
CREATE INDEX IF NOT EXISTS habits_owner_id_idx ON public.habits(owner_id);
CREATE INDEX IF NOT EXISTS habit_completions_owner_id_idx ON public.habit_completions(owner_id);
CREATE INDEX IF NOT EXISTS focus_sessions_owner_id_idx ON public.focus_sessions(owner_id);
CREATE INDEX IF NOT EXISTS library_items_owner_id_idx ON public.library_items(owner_id);
