-- =============================================================================
-- Sofia module — central de atendimento por voz (suasofia.online)
-- Tabelas: assistentes (espelho), chamadas (inbound + outbound), campanhas
-- e targets (lista de clientes a chamar).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sofia_assistants  — espelho dos assistentes configurados na Sofia
-- -----------------------------------------------------------------------------
CREATE TABLE public.sofia_assistants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sofia_id        bigint NOT NULL UNIQUE,
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('inbound', 'outbound')),
  status          text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  voice_id        bigint,
  language_id     bigint,
  phone_number_id bigint,
  webhook_url     text,
  inbound_webhook_url text,
  post_call_evaluation boolean DEFAULT false,
  post_call_schema jsonb,
  raw             jsonb,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sofia_assistants_type_idx ON public.sofia_assistants (type);
CREATE INDEX sofia_assistants_status_idx ON public.sofia_assistants (status);

ALTER TABLE public.sofia_assistants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sofia_assistants"
  ON public.sofia_assistants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 2. sofia_campaigns — campanhas de chamadas outbound
-- -----------------------------------------------------------------------------
CREATE TABLE public.sofia_campaigns (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  kind                     text NOT NULL CHECK (kind IN ('satisfaction', 'reactivation', 'custom')),
  assistant_sofia_id       bigint NOT NULL REFERENCES public.sofia_assistants(sofia_id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  default_variables        jsonb DEFAULT '{}'::jsonb,
  max_concurrent           int NOT NULL DEFAULT 1 CHECK (max_concurrent BETWEEN 1 AND 20),
  dial_window_start        time DEFAULT '09:00',
  dial_window_end          time DEFAULT '20:00',
  estimated_minutes_per_call numeric(5,2) DEFAULT 3.0,
  notes                    text,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  completed_at             timestamptz
);

CREATE INDEX sofia_campaigns_status_idx ON public.sofia_campaigns (status);
CREATE INDEX sofia_campaigns_kind_idx ON public.sofia_campaigns (kind);

ALTER TABLE public.sofia_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sofia_campaigns"
  ON public.sofia_campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 3. sofia_calls — todas as chamadas (inbound + outbound)
-- -----------------------------------------------------------------------------
CREATE TABLE public.sofia_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sofia_call_id       text UNIQUE,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  assistant_sofia_id  bigint REFERENCES public.sofia_assistants(sofia_id) ON DELETE SET NULL,
  phone               text,
  customer_name       text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'in_progress', 'completed', 'failed', 'no_answer', 'voicemail', 'cancelled')),
  duration_sec        int,
  cost_minutes        numeric(8,3),
  recording_url       text,
  transcript          jsonb,
  summary             text,
  extracted_data      jsonb,
  campaign_id         uuid REFERENCES public.sofia_campaigns(id) ON DELETE SET NULL,
  raw                 jsonb,
  started_at          timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sofia_calls_direction_idx ON public.sofia_calls (direction);
CREATE INDEX sofia_calls_status_idx ON public.sofia_calls (status);
CREATE INDEX sofia_calls_campaign_idx ON public.sofia_calls (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX sofia_calls_started_at_idx ON public.sofia_calls (started_at DESC NULLS LAST);
CREATE INDEX sofia_calls_phone_idx ON public.sofia_calls (phone);

ALTER TABLE public.sofia_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view sofia_calls"
  ON public.sofia_calls
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage sofia_calls"
  ON public.sofia_calls
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 4. sofia_campaign_targets — lista de clientes a chamar em cada campanha
-- -----------------------------------------------------------------------------
CREATE TABLE public.sofia_campaign_targets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES public.sofia_campaigns(id) ON DELETE CASCADE,
  phone               text NOT NULL,
  customer_name       text,
  variables           jsonb DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'dialing', 'completed', 'failed', 'skipped')),
  attempts            int NOT NULL DEFAULT 0,
  last_call_id        uuid REFERENCES public.sofia_calls(id) ON DELETE SET NULL,
  last_attempt_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sofia_targets_campaign_idx ON public.sofia_campaign_targets (campaign_id, status);
CREATE INDEX sofia_targets_phone_idx ON public.sofia_campaign_targets (phone);

ALTER TABLE public.sofia_campaign_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sofia_campaign_targets"
  ON public.sofia_campaign_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 5. Triggers de updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sofia_assistants_updated_at
  BEFORE UPDATE ON public.sofia_assistants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sofia_campaigns_updated_at
  BEFORE UPDATE ON public.sofia_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sofia_calls_updated_at
  BEFORE UPDATE ON public.sofia_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sofia_campaign_targets_updated_at
  BEFORE UPDATE ON public.sofia_campaign_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
