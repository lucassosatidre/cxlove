
ALTER TABLE public.delivery_checkins
  ADD COLUMN IF NOT EXISTS device_ip TEXT,
  ADD COLUMN IF NOT EXISTS device_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS device_info TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'entregador',
  ADD COLUMN IF NOT EXISTS admin_inserted_by UUID,
  ADD COLUMN IF NOT EXISTS admin_removed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_removed_by UUID;
