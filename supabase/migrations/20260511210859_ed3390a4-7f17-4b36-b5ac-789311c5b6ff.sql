ALTER TABLE public.audit_ifood_repasses
ADD COLUMN IF NOT EXISTS frota_garantida numeric(14,2) NOT NULL DEFAULT 0;