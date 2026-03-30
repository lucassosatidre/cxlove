import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ConfirmedDriver {
  nome: string;
  telefone: string;
}

export function useConfirmedDrivers(closingDate: string) {
  const [confirmedDrivers, setConfirmedDrivers] = useState<ConfirmedDriver[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!closingDate) return;

    const fetch = async () => {
      setLoading(true);
      // Get shifts for this date
      const { data: shifts } = await supabase
        .from('delivery_shifts')
        .select('id')
        .eq('data', closingDate);

      if (!shifts || shifts.length === 0) {
        setConfirmedDrivers([]);
        setLoading(false);
        return;
      }

      const shiftIds = shifts.map(s => s.id);
      const { data: checkins } = await supabase
        .from('delivery_checkins')
        .select('driver_id')
        .in('shift_id', shiftIds)
        .in('status', ['confirmado', 'concluido']);

      if (!checkins || checkins.length === 0) {
        setConfirmedDrivers([]);
        setLoading(false);
        return;
      }

      const driverIds = [...new Set(checkins.map(c => c.driver_id))];
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('nome, telefone')
        .in('id', driverIds)
        .order('nome');

      setConfirmedDrivers(drivers || []);
      setLoading(false);
    };

    fetch();
  }, [closingDate]);

  return { confirmedDrivers, loading };
}
