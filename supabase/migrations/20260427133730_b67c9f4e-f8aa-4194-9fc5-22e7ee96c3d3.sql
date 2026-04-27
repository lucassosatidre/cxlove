-- Recreate view with security_invoker so RLS of underlying tables applies
DROP VIEW IF EXISTS public.vw_period_imports;
CREATE VIEW public.vw_period_imports
WITH (security_invoker = true) AS
SELECT 
  audit_period_id,
  file_type AS source,
  status,
  file_name,
  imported_rows,
  created_at
FROM public.audit_imports
UNION ALL
SELECT 
  audit_period_id,
  operadora AS source,
  status,
  file_name,
  (COALESCE(imported_lots, 0) + COALESCE(imported_items, 0)) AS imported_rows,
  imported_at AS created_at
FROM public.voucher_imports;

GRANT SELECT ON public.vw_period_imports TO authenticated;