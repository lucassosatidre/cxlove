ALTER TABLE public.vault_daily_closings ADD COLUMN vault_entry_counts jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.vault_daily_closings ADD COLUMN vault_exit_counts jsonb DEFAULT '{}'::jsonb;