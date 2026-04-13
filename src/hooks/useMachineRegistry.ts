import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MachineRegistryEntry {
  friendly_name: string;
  category: string;
  serial_number: string;
}

export function useMachineRegistry() {
  const [registry, setRegistry] = useState<Map<string, MachineRegistryEntry>>(new Map());
  const [entries, setEntries] = useState<MachineRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('machine_registry')
        .select('serial_number, friendly_name, category')
        .eq('is_active', true)
        .order('friendly_name');

      const map = new Map<string, MachineRegistryEntry>();
      const list: MachineRegistryEntry[] = [];
      (data || []).forEach((r: any) => {
        const entry = { friendly_name: r.friendly_name, category: r.category, serial_number: r.serial_number };
        map.set(r.serial_number, entry);
        list.push(entry);
      });
      setRegistry(map);
      setEntries(list);
      setLoading(false);
    };
    load();
  }, []);

  const getFriendlyName = (serial: string): string | null => {
    const cleaned = serial.replace(/^S1F2-000/, '');
    return registry.get(cleaned)?.friendly_name || null;
  };

  return { registry, entries, getFriendlyName, loading };
}
