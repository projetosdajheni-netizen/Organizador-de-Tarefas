import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://lrpjprbfwqzaywmrmlvd.supabase.co',
  'sb_publishable_14zi-65trGd1cr6JZEZxVg_aJ8itflN',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
