-- Estágio 2 da auditoria voucher — suporte a 1 lote pago em 2 depósitos BB.
--
-- Casos reais (Alelo fev/mar 2026):
-- - ALELO-20260218 R$692,23 = #10 (R$530,95) + #11 (R$161,28) no mesmo dia
-- - ALELO-20260302 R$412,13 = #17 (R$311,49) + outro (R$100,64)
--
-- Operadora pode dividir o repasse de um único lote em 2 TEDs separados (com
-- ou sem mesma data). Adicionamos uma coluna secundária pra suportar esse caso.
-- bb_deposit_id continua sendo o primário (cache); bb_deposit_id_2 é o secundário.
-- Pra N>2 (não visto até agora), faríamos uma junction table — fica como TODO.

ALTER TABLE public.audit_voucher_lots
  ADD COLUMN IF NOT EXISTS bb_deposit_id_2 uuid
  REFERENCES public.audit_bank_deposits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_lots_bb_deposit_2
  ON public.audit_voucher_lots(bb_deposit_id_2);
