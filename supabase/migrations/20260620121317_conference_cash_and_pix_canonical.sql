-- Conferência de Entregadores: campo de dinheiro recebido + padronização do Pix físico.

-- Campo de dinheiro por entregador (informativo; não exige match de cartão).
ALTER TABLE public.machine_readings
  ADD COLUMN IF NOT EXISTS cash_amount numeric NOT NULL DEFAULT 0;

-- Padroniza o Pix físico já existente nas transações da maquininha para "(COBRAR) Pix".
-- Saipos manda "(COBRAR) Pix"; arquivo da maquininha (iFood Pago) manda só "Pix".
-- Não toca em Pix pago/online (ex: "(PAGO) Pix Banco do Brasil").
UPDATE public.card_transactions
SET payment_method = '(COBRAR) Pix'
WHERE lower(payment_method) LIKE '%pix%'
  AND lower(payment_method) NOT LIKE '%pago%'
  AND lower(payment_method) NOT LIKE '%online%'
  AND lower(payment_method) NOT LIKE '%banco do brasil%'
  AND payment_method <> '(COBRAR) Pix';
