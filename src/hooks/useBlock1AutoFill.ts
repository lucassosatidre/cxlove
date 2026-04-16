import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DenomCounts, emptyDenomCounts, snapshotCountsToReais } from '@/components/DenominationCountTable';
import { format } from 'date-fns';

interface AutoFillResult {
  salao: DenomCounts;
  tele: DenomCounts;
  cofre: DenomCounts;
  loaded: boolean;
}

/**
 * Auto-fills Block 1 denomination counts from:
 * - Salon: cash_snapshots with snapshot_type='fechamento' + salon_closing_id (latest by date)
 * - Tele: cash_snapshots with snapshot_type='fechamento' + daily_closing_id (latest by date)
 * - Cofre: vault_daily_closings.cofre_final from previous closing (before formDate)
 *
 * cash_snapshots.counts stores QTY per denomination → converted to R$ via snapshotCountsToReais
 * vault_daily_closings.cofre_final already stores R$ per denomination
 */
export function useBlock1AutoFill(formDate: Date, editingId: string | null) {
  const [autoFill, setAutoFill] = useState<AutoFillResult>({
    salao: emptyDenomCounts(),
    tele: emptyDenomCounts(),
    cofre: emptyDenomCounts(),
    loaded: false,
  });

  const loadAutoFill = useCallback(async () => {
    const dateStr = format(formDate, 'yyyy-MM-dd');

    // If editing an existing record, don't auto-fill (data already loaded)
    if (editingId) {
      setAutoFill(prev => ({ ...prev, loaded: true }));
      return;
    }

    const [salonSnap, teleSnap, prevVault] = await Promise.all([
      // Latest salon cash_snapshot (fechamento) for the selected date
      // Find salon_closing for the date, then get its snapshot
      supabase
        .from('salon_closings')
        .select('id')
        .eq('closing_date', dateStr)
        .limit(1)
        .maybeSingle()
        .then(async ({ data: closing }) => {
          if (!closing) return null;
          const { data } = await supabase
            .from('cash_snapshots')
            .select('counts')
            .eq('salon_closing_id', closing.id)
            .eq('snapshot_type', 'fechamento')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return data;
        }),

      // Latest tele cash_snapshot (fechamento) for the selected date
      supabase
        .from('daily_closings')
        .select('id')
        .eq('closing_date', dateStr)
        .limit(1)
        .maybeSingle()
        .then(async ({ data: closing }) => {
          if (!closing) return null;
          const { data } = await supabase
            .from('cash_snapshots')
            .select('counts')
            .eq('daily_closing_id', closing.id)
            .eq('snapshot_type', 'fechamento')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return data;
        }),

      // Previous vault closing cofre_final (before formDate)
      supabase
        .from('vault_daily_closings')
        .select('cofre_final')
        .lt('closing_date', dateStr)
        .order('closing_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const salao = salonSnap?.counts
      ? snapshotCountsToReais(salonSnap.counts as Record<string, number>)
      : emptyDenomCounts();

    const tele = teleSnap?.counts
      ? snapshotCountsToReais(teleSnap.counts as Record<string, number>)
      : emptyDenomCounts();

    const cofre = prevVault?.data?.cofre_final
      ? (prevVault.data.cofre_final as DenomCounts)
      : emptyDenomCounts();

    setAutoFill({ salao, tele, cofre, loaded: true });
  }, [formDate, editingId]);

  useEffect(() => {
    loadAutoFill();
  }, [loadAutoFill]);

  return autoFill;
}
