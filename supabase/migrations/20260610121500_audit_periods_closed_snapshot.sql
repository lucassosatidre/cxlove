-- Trava do mês (Relatórios V2): snapshot do relatório contábil gravado no "Fechar Período".
-- Quando audit_periods.status = 'fechado', a tela renderiza DESTE snapshot (não recalcula ao vivo).
-- "Reabrir o mês" volta o status pra 'aberto' mas MANTÉM o snapshot como backup.
ALTER TABLE public.audit_periods
  ADD COLUMN IF NOT EXISTS closed_snapshot jsonb;

COMMENT ON COLUMN public.audit_periods.closed_snapshot IS
  'Backup JSON do relatório contábil (resumido + detalhado, formato ContabilPdfData) salvo no fechamento do período. Mantido ao reabrir.';
