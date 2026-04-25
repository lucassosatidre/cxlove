-- 1. Colunas de auditoria
ALTER TABLE public.delivery_checkins
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_from_freed_by uuid;

-- 2. RPC SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.promote_from_waitlist(
  p_shift_id uuid,
  p_freed_by uuid,
  p_is_after_18h boolean DEFAULT false,
  p_max_promotions integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vagas_configuradas integer;
  v_confirmados_atual integer;
  v_vagas_abertas integer;
  v_to_promote integer;
  v_promoted jsonb := '[]'::jsonb;
  v_next record;
  v_driver record;
  v_admin record;
  v_waitlist_pos integer;
  v_driver_msg text;
  v_admin_msg text;
  v_remaining integer;
BEGIN
  -- Pega vagas configuradas
  SELECT vagas INTO v_vagas_configuradas
  FROM delivery_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF v_vagas_configuradas IS NULL THEN
    RETURN jsonb_build_object('promoted_count', 0, 'reason', 'turno_nao_encontrado', 'promoted', v_promoted);
  END IF;

  -- Conta confirmados atuais
  SELECT count(*) INTO v_confirmados_atual
  FROM delivery_checkins
  WHERE shift_id = p_shift_id AND status = 'confirmado';

  v_vagas_abertas := v_vagas_configuradas - v_confirmados_atual;

  -- Regra semântica: só promove se há vaga aberta de fato
  IF v_vagas_abertas <= 0 THEN
    RETURN jsonb_build_object(
      'promoted_count', 0,
      'reason', 'sem_vaga_aberta',
      'vagas_configuradas', v_vagas_configuradas,
      'confirmados_atual', v_confirmados_atual,
      'vagas_abertas', v_vagas_abertas,
      'promoted', v_promoted
    );
  END IF;

  v_to_promote := LEAST(v_vagas_abertas, GREATEST(p_max_promotions, 1));
  v_remaining := v_to_promote;

  -- Loop pela fila ordenada por waitlist_entered_at
  FOR v_next IN
    SELECT id, driver_id, waitlist_entered_at
    FROM delivery_checkins
    WHERE shift_id = p_shift_id
      AND status = 'fila_espera'
      AND waitlist_entered_at IS NOT NULL
    ORDER BY waitlist_entered_at ASC
    LIMIT v_to_promote
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Promove
    UPDATE delivery_checkins
    SET status = 'confirmado',
        confirmed_at = now(),
        promoted_at = now(),
        promoted_from_freed_by = p_freed_by,
        substituto_pos_18h = CASE WHEN p_is_after_18h THEN true ELSE substituto_pos_18h END
    WHERE id = v_next.id;

    -- Busca dados do driver promovido
    SELECT nome, auth_user_id INTO v_driver
    FROM delivery_drivers
    WHERE id = v_next.driver_id;

    -- Posição original na fila (1-based)
    SELECT count(*) INTO v_waitlist_pos
    FROM delivery_checkins
    WHERE shift_id = p_shift_id
      AND waitlist_entered_at IS NOT NULL
      AND waitlist_entered_at <= v_next.waitlist_entered_at;

    -- Log
    INSERT INTO delivery_checkin_logs (checkin_id, driver_id, action, performed_by)
    VALUES (v_next.id, v_next.driver_id, 'fila_promovido', p_freed_by);

    -- Notificação ao promovido
    IF v_driver.auth_user_id IS NOT NULL THEN
      v_driver_msg := CASE
        WHEN p_is_after_18h THEN 'Você foi chamado da fila de espera para o turno de hoje. Entre em contato com a pizzaria'
        ELSE 'Você foi promovido da fila de espera! Seu check-in está confirmado para hoje.'
      END;

      INSERT INTO notifications (user_id, title, message, type)
      VALUES (v_driver.auth_user_id, 'Fila de espera', v_driver_msg, 'fila_promovido');
    END IF;

    -- Notifica admins
    v_admin_msg := CASE
      WHEN p_is_after_18h THEN format('O entregador %s (posição %s da fila) foi adicionado da fila de espera. Avise-o pois o horário já passou das 18h', COALESCE(v_driver.nome, 'Entregador'), v_waitlist_pos)
      ELSE format('O entregador %s (posição %s da fila) foi promovido automaticamente da fila de espera', COALESCE(v_driver.nome, 'Entregador'), v_waitlist_pos)
    END;

    FOR v_admin IN
      SELECT user_id FROM user_roles WHERE role = 'admin'
    LOOP
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (v_admin.user_id, 'Fila de espera — promoção', v_admin_msg, 'fila_promovido_admin');
    END LOOP;

    v_promoted := v_promoted || jsonb_build_object(
      'checkin_id', v_next.id,
      'driver_id', v_next.driver_id,
      'nome', COALESCE(v_driver.nome, 'Entregador')
    );

    v_remaining := v_remaining - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'promoted_count', jsonb_array_length(v_promoted),
    'vagas_configuradas', v_vagas_configuradas,
    'confirmados_atual', v_confirmados_atual + jsonb_array_length(v_promoted),
    'vagas_abertas_iniciais', v_vagas_abertas,
    'reason', CASE WHEN jsonb_array_length(v_promoted) = 0 THEN 'fila_vazia' ELSE 'ok' END,
    'promoted', v_promoted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_from_waitlist(uuid, uuid, boolean, integer) TO authenticated;