ALTER TABLE public.delivery_drivers ADD COLUMN cnpj TEXT;
UPDATE public.delivery_drivers SET cnpj = cpf WHERE cpf IS NOT NULL;
ALTER TABLE public.delivery_drivers DROP COLUMN cpf;