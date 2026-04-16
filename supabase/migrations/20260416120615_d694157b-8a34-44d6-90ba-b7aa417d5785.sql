
ALTER TABLE public.vault_daily_closings
  ADD COLUMN contagem_salao JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb,
  ADD COLUMN contagem_tele JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb,
  ADD COLUMN contagem_cofre JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb,
  ADD COLUMN trocos_salao JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb,
  ADD COLUMN trocos_tele JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb,
  ADD COLUMN cofre_final JSONB DEFAULT '{"200":0,"100":0,"50":0,"20":0,"10":0,"5":0,"2":0}'::jsonb;
