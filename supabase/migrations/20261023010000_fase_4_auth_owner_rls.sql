-- Phase 4: bind all persisted rows to a Supabase Auth user.
-- Legacy rows stay unowned until the authenticated one-time claim migrates them.
-- Remove every existing policy on these tables before adding owner-only policies,
-- so an older permissive policy cannot accidentally grant broader access.
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['sync_spaces','tasks','habits','habit_completions','focus_sessions','library_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY['sync_spaces','tasks','habits','habit_completions','focus_sessions','library_items'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['sync_spaces','tasks','habits','habit_completions','focus_sessions','library_items'] LOOP
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = owner_id) WITH CHECK ((select auth.uid()) = owner_id)', t);
    EXECUTE format('CREATE POLICY owner_delete ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = owner_id)', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS sync_spaces_owner_id_idx ON public.sync_spaces(owner_id);
CREATE INDEX IF NOT EXISTS tasks_owner_id_idx ON public.tasks(owner_id);
CREATE INDEX IF NOT EXISTS habits_owner_id_idx ON public.habits(owner_id);
CREATE INDEX IF NOT EXISTS habit_completions_owner_id_idx ON public.habit_completions(owner_id);
CREATE INDEX IF NOT EXISTS focus_sessions_owner_id_idx ON public.focus_sessions(owner_id);
CREATE INDEX IF NOT EXISTS library_items_owner_id_idx ON public.library_items(owner_id);

-- Claim the legacy sync space and every related row in one transaction.
-- Only the server-side service role may execute this function.
CREATE OR REPLACE FUNCTION public.claim_meu_ritmo_legacy_space(p_space_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner uuid;
  n_tasks integer;
  n_habits integer;
  n_completions integer;
  n_focus integer;
  n_library integer;
BEGIN
  SELECT owner_id INTO v_owner
  FROM public.sync_spaces
  WHERE id = p_space_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy_space_not_found';
  END IF;
  IF v_owner IS NOT NULL AND v_owner <> p_user_id THEN
    RAISE EXCEPTION 'legacy_space_owned_by_another_user';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tasks WHERE space_id = p_space_id AND owner_id IS NOT NULL AND owner_id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.habits WHERE space_id = p_space_id AND owner_id IS NOT NULL AND owner_id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.habit_completions WHERE space_id = p_space_id AND owner_id IS NOT NULL AND owner_id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.focus_sessions WHERE space_id = p_space_id AND owner_id IS NOT NULL AND owner_id <> p_user_id)
     OR EXISTS (SELECT 1 FROM public.library_items WHERE space_id = p_space_id AND owner_id IS NOT NULL AND owner_id <> p_user_id) THEN
    RAISE EXCEPTION 'legacy_rows_owned_by_another_user';
  END IF;

  UPDATE public.sync_spaces SET owner_id = p_user_id, last_seen_at = now() WHERE id = p_space_id;
  UPDATE public.tasks SET owner_id = p_user_id WHERE space_id = p_space_id AND owner_id IS NULL;
  GET DIAGNOSTICS n_tasks = ROW_COUNT;
  UPDATE public.habits SET owner_id = p_user_id WHERE space_id = p_space_id AND owner_id IS NULL;
  GET DIAGNOSTICS n_habits = ROW_COUNT;
  UPDATE public.habit_completions SET owner_id = p_user_id WHERE space_id = p_space_id AND owner_id IS NULL;
  GET DIAGNOSTICS n_completions = ROW_COUNT;
  UPDATE public.focus_sessions SET owner_id = p_user_id WHERE space_id = p_space_id AND owner_id IS NULL;
  GET DIAGNOSTICS n_focus = ROW_COUNT;
  UPDATE public.library_items SET owner_id = p_user_id WHERE space_id = p_space_id AND owner_id IS NULL;
  GET DIAGNOSTICS n_library = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'migrated', jsonb_build_object(
    'tasks', n_tasks, 'habits', n_habits, 'habit_completions', n_completions,
    'focus_sessions', n_focus, 'library_items', n_library
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_meu_ritmo_legacy_space(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meu_ritmo_legacy_space(uuid, uuid) TO service_role;
