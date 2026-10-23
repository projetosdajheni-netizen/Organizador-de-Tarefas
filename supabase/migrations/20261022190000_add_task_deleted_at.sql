alter table public.tasks
  add column if not exists deleted_at timestamptz;
