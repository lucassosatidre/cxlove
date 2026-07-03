CREATE OR REPLACE FUNCTION public.calc_cashflow_tx_row_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.row_hash := md5(
    upper(coalesce(NEW.source,'')) ||'|'||
    coalesce(NEW.account_id::text,'') ||'|'||
    coalesce(NEW.tx_date::text,'') ||'|'||
    to_char(coalesce(NEW.amount,0),'FM999999990.00') ||'|'||
    upper(trim(coalesce(NEW.description,''))) ||'|'||
    upper(trim(coalesce(NEW.detail,''))) ||'|'||
    to_char(coalesce(NEW.running_balance,0),'FM999999990.00') ||'|'||
    coalesce(NEW.source_seq,0)::text ||
    CASE WHEN NEW.external_id IS NOT NULL AND NEW.external_id <> '' THEN '|'||NEW.external_id ELSE '' END
  );
  RETURN NEW;
END;$function$;