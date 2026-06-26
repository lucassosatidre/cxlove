
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.cashflow_transactions
  ADD COLUMN IF NOT EXISTS source_seq int NOT NULL DEFAULT 0;

ALTER TABLE public.cashflow_saipos
  ADD COLUMN IF NOT EXISTS source_seq int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_frente_caixa boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS cashflow_transactions_row_hash_key
  ON public.cashflow_transactions(row_hash);
CREATE UNIQUE INDEX IF NOT EXISTS cashflow_saipos_row_hash_key
  ON public.cashflow_saipos(row_hash);

CREATE OR REPLACE FUNCTION public.calc_cashflow_tx_row_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.row_hash := encode(digest(
    upper(coalesce(NEW.source,'')) ||'|'||
    coalesce(NEW.account_id::text,'') ||'|'||
    coalesce(NEW.tx_date::text,'') ||'|'||
    to_char(coalesce(NEW.amount,0),'FM999999990.00') ||'|'||
    upper(trim(coalesce(NEW.description,''))) ||'|'||
    upper(trim(coalesce(NEW.detail,''))) ||'|'||
    to_char(coalesce(NEW.running_balance,0),'FM999999990.00') ||'|'||
    coalesce(NEW.source_seq,0)::text
  ,'sha256'),'hex');
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_calc_cashflow_tx_row_hash ON public.cashflow_transactions;
CREATE TRIGGER trg_calc_cashflow_tx_row_hash
  BEFORE INSERT ON public.cashflow_transactions
  FOR EACH ROW EXECUTE FUNCTION public.calc_cashflow_tx_row_hash();

CREATE OR REPLACE FUNCTION public.calc_cashflow_saipos_row_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.row_hash := encode(digest(
    'saipos|'||
    upper(coalesce(NEW.company,'')) ||'|'||
    coalesce(NEW.vencimento::text,'') ||'|'||
    coalesce(NEW.emissao::text,'') ||'|'||
    coalesce(NEW.pagamento::text,'') ||'|'||
    to_char(coalesce(NEW.amount,0),'FM999999990.00') ||'|'||
    upper(trim(coalesce(NEW.payment_method,''))) ||'|'||
    upper(trim(coalesce(NEW.category,''))) ||'|'||
    upper(trim(coalesce(NEW.fornecedor,''))) ||'|'||
    upper(trim(coalesce(NEW.descricao,''))) ||'|'||
    coalesce(NEW.paid,false)::text ||'|'||
    coalesce(NEW.source_seq,0)::text
  ,'sha256'),'hex');
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_calc_cashflow_saipos_row_hash ON public.cashflow_saipos;
CREATE TRIGGER trg_calc_cashflow_saipos_row_hash
  BEFORE INSERT ON public.cashflow_saipos
  FOR EACH ROW EXECUTE FUNCTION public.calc_cashflow_saipos_row_hash();
