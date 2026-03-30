
-- 1. Add 'entregador' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'entregador';

-- 2. Create delivery_drivers table
CREATE TABLE public.delivery_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  nome text NOT NULL,
  telefone text NOT NULL,
  email text NOT NULL,
  cpf text,
  pix text,
  status text NOT NULL DEFAULT 'ativo',
  max_periodos_dia integer NOT NULL DEFAULT 1,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_drivers ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "Admins full access delivery_drivers" ON public.delivery_drivers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Entregador: SELECT own record
CREATE POLICY "Entregador can view own driver profile" ON public.delivery_drivers
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- Other authenticated: SELECT all (for reference in reconciliation)
CREATE POLICY "Authenticated users can view delivery drivers" ON public.delivery_drivers
  FOR SELECT TO authenticated
  USING (true);

-- 3. Create delivery_shifts table
CREATE TABLE public.delivery_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  periodo text NOT NULL,
  vagas integer NOT NULL DEFAULT 6,
  horario_inicio time,
  horario_fim time,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (data, periodo)
);

ALTER TABLE public.delivery_shifts ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "Admins full access delivery_shifts" ON public.delivery_shifts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- All authenticated: SELECT
CREATE POLICY "Authenticated users can view delivery shifts" ON public.delivery_shifts
  FOR SELECT TO authenticated
  USING (true);

-- 4. Create delivery_checkins table
CREATE TABLE public.delivery_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.delivery_shifts(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.delivery_drivers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'confirmado',
  confirmed_at timestamptz DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, driver_id)
);

ALTER TABLE public.delivery_checkins ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "Admins full access delivery_checkins" ON public.delivery_checkins
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Entregador: SELECT own checkins
CREATE POLICY "Entregador can view own checkins" ON public.delivery_checkins
  FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.delivery_drivers WHERE auth_user_id = auth.uid()));

-- Entregador: INSERT own checkins
CREATE POLICY "Entregador can insert own checkins" ON public.delivery_checkins
  FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM public.delivery_drivers WHERE auth_user_id = auth.uid()));

-- Entregador: UPDATE own checkins (for cancellation)
CREATE POLICY "Entregador can update own checkins" ON public.delivery_checkins
  FOR UPDATE TO authenticated
  USING (driver_id IN (SELECT id FROM public.delivery_drivers WHERE auth_user_id = auth.uid()));

-- Other authenticated: SELECT all
CREATE POLICY "Authenticated users can view delivery checkins" ON public.delivery_checkins
  FOR SELECT TO authenticated
  USING (true);
