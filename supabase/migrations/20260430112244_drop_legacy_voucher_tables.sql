-- Fase 0 do estágio 2 da auditoria: faxina de tabelas voucher antigas (vazias).
-- Schema voucher anterior (voucher_imports / voucher_lots / voucher_lot_items)
-- nunca chegou a ter dados em produção e o estágio 2 vai usar tabelas novas
-- (audit_voucher_lots / audit_voucher_lot_items) com schema diferente.
-- Drop em ordem reversa pra respeitar FKs caso existam.

DROP TABLE IF EXISTS public.voucher_lot_items CASCADE;
DROP TABLE IF EXISTS public.voucher_lots CASCADE;
DROP TABLE IF EXISTS public.voucher_imports CASCADE;
