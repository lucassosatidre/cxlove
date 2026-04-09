CREATE OR REPLACE FUNCTION public.attempt_checkin(p_shift_id uuid, p_driver_id uuid, p_device_ip text DEFAULT NULL::text, p_device_user_agent text DEFAULT NULL::text, p_device_info text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vagas integer;
  v_shift_date date;
  v_operational_date date;
  v_brasilia_hour integer;
  v_confirmed_count integer;
  v_existing_id uuid;
  v_existing_status text;
  v_target_status text;
  v_checkin_id uuid;
  v_now timestamptz := now();
  v_waitlist_pos integer;
BEGIN
  -- Lock the shift row to prevent race conditions
  SELECT vagas, data INTO v_vagas, v_shift_date
  FROM delivery_shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF v_vagas IS NULL THEN
    RETURN jsonb_build_object('error', 'Turno não encontrado');
  END IF;

  -- Calculate current operational date in Brasília timezone
  v_brasilia_hour := EXTRACT(HOUR FROM (v_now AT TIME ZONE 'America/Sao_Paulo'));
  IF v_brasilia_hour < 3 THEN
    v_operational_date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date - INTERVAL '1 day';
  ELSE
    v_operational_date := (v_now AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;

  -- Validate shift date matches operational date (drivers can only check in for today)
  IF v_shift_date <> v_operational_date THEN
    RETURN jsonb_build_object('error', 'Check-in permitido apenas para o turno do dia atual');
  END IF;

  -- Check if driver already has an active checkin for this shift
  SELECT id, status INTO v_existing_id, v_existing_status
  FROM delivery_checkins
  WHERE shift_id = p_shift_id
    AND driver_id = p_driver_id
    AND status IN ('confirmado', 'fila_espera', 'em_rota')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status = 'fila_espera' THEN
      RETURN jsonb_build_object('status', 'already_waitlist', 'checkin_id', v_existing_id);
    ELSE
      RETURN jsonb_build_object('status', 'already_confirmed', 'checkin_id', v_existing_id);
    END IF;
  END IF;

  -- Count confirmed
  SELECT count(*) INTO v_confirmed_count
  FROM delivery_checkins
  WHERE shift_id = p_shift_id
    AND status = 'confirmado';

  -- Determine target status
  IF v_confirmed_count < v_vagas THEN
    v_target_status := 'confirmado';
  ELSE
    v_target_status := 'fila_espera';
  END IF;

  -- Delete any old cancelled/expired records for this driver+shift to avoid clutter
  DELETE FROM delivery_checkins
  WHERE shift_id = p_shift_id
    AND driver_id = p_driver_id
    AND status NOT IN ('confirmado', 'fila_espera', 'em_rota');

  -- Insert fresh record
  INSERT INTO delivery_checkins (shift_id, driver_id, status, device_ip, device_user_agent, device_info, origin, confirmed_at, waitlist_entered_at)
  VALUES (
    p_shift_id, p_driver_id, v_target_status, p_device_ip, p_device_user_agent, p_device_info, 'entregador',
    CASE WHEN v_target_status = 'confirmado' THEN v_now ELSE NULL END,
    CASE WHEN v_target_status = 'fila_espera' THEN v_now ELSE NULL END
  )
  RETURNING id INTO v_checkin_id;

  -- Log the action
  INSERT INTO delivery_checkin_logs (checkin_id, driver_id, action, performed_by, device_ip, device_user_agent, device_info)
  VALUES (
    v_checkin_id, p_driver_id,
    CASE WHEN v_target_status = 'confirmado' THEN 'checkin' ELSE 'fila_entrada' END,
    p_driver_id, p_device_ip, p_device_user_agent, p_device_info
  );

  -- If waitlist, calculate position
  IF v_target_status = 'fila_espera' THEN
    SELECT count(*) INTO v_waitlist_pos
    FROM delivery_checkins
    WHERE shift_id = p_shift_id
      AND status = 'fila_espera'
      AND waitlist_entered_at <= v_now;
  END IF;

  RETURN jsonb_build_object(
    'status', v_target_status,
    'checkin_id', v_checkin_id,
    'posicao', COALESCE(v_waitlist_pos, 0)
  );
END;
$function$;