import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { ACCESS_POLL_MS, type AccessInfo } from '../services/accessGate';

/**
 * Whether the owner has approved this account (and whether this account is the
 * owner: `data.is_owner`). Key: ['me-access']. Saved to the phone so an approved
 * user isn't stopped at a loading screen while the server wakes; staleTime 0 means
 * it's re-asked on every launch, so an approval or a decline still shows up.
 * Refetches when the app returns to the foreground and every 30 s while pending.
 */
export function useAccess(enabled = true) {
  const query = useQuery({
    queryKey: ['me-access'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<AccessInfo>('/me/access');
      return data;
    },
    staleTime: 0,
    // The free server can take ~1 min to wake: keep trying before saying it's unreachable.
    retry: 4,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 15_000),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? ACCESS_POLL_MS : false),
  });

  const { refetch } = query;
  const status = query.data?.status;
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && status !== 'approved') void refetch();
    });
    return () => sub.remove();
  }, [enabled, status, refetch]);

  return query;
}
