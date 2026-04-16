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
 * - Salon: cash_snapshots with snapshot_type='fechamento' + salon_closing_id (latest by closing_date)
 * - Tele: cash_snapshots with snapshot_type='fechamento' + daily_closing_id (latest by closing_date)
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
      // Latest salon fechamento snapshot: query cash_snapshots directly,
      // joining salon_closings to get closing_date for ordering.
      // We filter closing_date <= dateStr so we get the most recent one.
      supabase
        .from('cash_snapshots')
        .select('counts, salon_closings!inner(closing_date)')
        .eq('snapshot_type', 'fechamento')
        .not('salon_closing_id', 'is', null)
        .lte('salon_closings.closing_date', dateStr)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Latest tele fechamento snapshot
      supabase
        .from('cash_snapshots')
        .select('counts, daily_closings!inner(closing_date)')
        .eq('snapshot_type', 'fechamento')
        .not('daily_closing_id', 'is', null)
        .lte('daily_closings.closing_date', dateStr)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Previous vault closing cofre_final (before formDate)
      supabase
        .from('vault_daily_closings')
        .select('cofre_final')
        .lt('closing_date', dateStr)
        .order('closing_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const salao = salonSnap?.data?.counts
      ? snapshotCountsToReais(salonSnap.data.counts as Record<string, number>)
      : emptyDenomCounts();

    const tele = teleSnap?.data?.counts
      ? snapshotCountsToReais(teleSnap.data.counts as Record<string, number>)
      : emptyDenomCounts();

    const cofre = prevVault?.data?.cofre_final
      ? (prevVault.data.cofre_final as unknown as DenomCounts)
      : emptyDenomCounts();

    setAutoFill({ salao, tele, cofre, loaded: true });
  }, [formDate, editingId]);

  useEffect(() => {
    loadAutoFill();
  }, [loadAutoFill]);

  return autoFill;
}
