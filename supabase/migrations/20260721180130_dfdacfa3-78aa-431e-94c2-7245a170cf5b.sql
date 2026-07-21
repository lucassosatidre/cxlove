
-- Controladoria Financeira — módulo isolado
-- 1) Colunas aditivas em nfe_entrada
ALTER TABLE public.nfe_entrada
  ADD COLUMN IF NOT EXISTS duplicatas jsonb,
  ADD COLUMN IF NOT EXISTS pag_method text;

-- 2) ctrl_contas_pagar
CREATE TABLE IF NOT EXISTS public.ctrl_contas_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emissao date,
  vencimento date,
  pagamento date,
  paid boolean NOT NULL DEFAULT false,
  amount numeric NOT NULL,
  category text,
  payment_method text,
  conta text,
  fornecedor text,
  descricao text,
  cnpj text,
  numero_nota text,
  source text NOT NULL DEFAULT 'nfe',
  nota_chave text,
  parcela text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ctrl_contas_pagar_nota_parcela_key
  ON public.ctrl_contas_pagar (nota_chave, parcela)
  WHERE nota_chave IS NOT NULL AND parcela IS NOT NULL;
CREATE INDEX IF NOT EXISTS ctrl_contas_pagar_vencimento_idx ON public.ctrl_contas_pagar (vencimento);
CREATE INDEX IF NOT EXISTS ctrl_contas_pagar_emissao_idx ON public.ctrl_contas_pagar (emissao);
CREATE INDEX IF NOT EXISTS ctrl_contas_pagar_paid_idx ON public.ctrl_contas_pagar (paid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ctrl_contas_pagar TO authenticated;
GRANT ALL ON public.ctrl_contas_pagar TO service_role;

ALTER TABLE public.ctrl_contas_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access ctrl_contas_pagar"
  ON public.ctrl_contas_pagar
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ctrl_contas_pagar_updated_at
  BEFORE UPDATE ON public.ctrl_contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.update_audit_periods_updated_at();

-- 3) ctrl_nota_status
CREATE TABLE IF NOT EXISTS public.ctrl_nota_status (
  chave text PRIMARY KEY,
  tipo text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ctrl_nota_status TO authenticated;
GRANT ALL ON public.ctrl_nota_status TO service_role;

ALTER TABLE public.ctrl_nota_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access ctrl_nota_status"
  ON public.ctrl_nota_status
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ctrl_nota_status_updated_at
  BEFORE UPDATE ON public.ctrl_nota_status
  FOR EACH ROW EXECUTE FUNCTION public.update_audit_periods_updated_at();
