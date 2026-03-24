import { describe, expect, it } from 'vitest';

import { getLatestCashSnapshots } from '@/lib/cash-snapshot-utils';

describe('getLatestCashSnapshots', () => {
  it('keeps only the latest snapshot per type even with mixed users', () => {
    const snapshots = [
      {
        snapshot_type: 'abertura',
        updated_at: '2026-03-23T23:05:07.172Z',
        total: 0,
        user_id: 'old-user',
      },
      {
        snapshot_type: 'fechamento',
        updated_at: '2026-03-23T23:05:24.827Z',
        total: 0,
        user_id: 'old-user',
      },
      {
        snapshot_type: 'abertura',
        updated_at: '2026-03-24T21:12:08.920Z',
        total: 1,
        user_id: 'new-user',
      },
      {
        snapshot_type: 'fechamento',
        updated_at: '2026-03-24T21:12:14.297Z',
        total: 0.5,
        user_id: 'new-user',
      },
    ];

    const latest = getLatestCashSnapshots(snapshots);

    expect(latest.abertura?.total).toBe(1);
    expect(latest.fechamento?.total).toBe(0.5);
  });
});