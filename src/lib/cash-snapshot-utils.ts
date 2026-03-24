type SnapshotType = 'abertura' | 'fechamento';

export interface CashSnapshotLike {
  snapshot_type?: string | null;
  updated_at: string;
}

const getSnapshotTimestamp = (updatedAt: string) => {
  const timestamp = new Date(updatedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export function getLatestCashSnapshots<T extends CashSnapshotLike>(snapshots: T[]) {
  return snapshots.reduce<Partial<Record<SnapshotType, T>>>((acc, snapshot) => {
    const type: SnapshotType = snapshot.snapshot_type === 'fechamento' ? 'fechamento' : 'abertura';
    const current = acc[type];

    if (!current || getSnapshotTimestamp(snapshot.updated_at) > getSnapshotTimestamp(current.updated_at)) {
      acc[type] = snapshot;
    }

    return acc;
  }, {});
}