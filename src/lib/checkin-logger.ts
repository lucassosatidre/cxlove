import { supabase } from '@/integrations/supabase/client';

export type CheckinAction =
  | 'checkin'
  | 'cancelamento'
  | 'fila_entrada'
  | 'fila_saida'
  | 'fila_promovido'
  | 'admin_removido'
  | 'admin_adicionado';

interface LogParams {
  checkinId: string;
  driverId: string;
  action: CheckinAction;
  performedBy: string;
  deviceIp?: string | null;
  deviceUserAgent?: string | null;
  deviceInfo?: string | null;
}

export async function logCheckinAction(params: LogParams) {
  const { error } = await supabase.from('delivery_checkin_logs').insert({
    checkin_id: params.checkinId,
    driver_id: params.driverId,
    action: params.action,
    performed_by: params.performedBy,
    device_ip: params.deviceIp || null,
    device_user_agent: params.deviceUserAgent || null,
    device_info: params.deviceInfo || null,
  });

  if (error) {
    console.error('Erro ao registrar log de check-in:', error);
  }
}
