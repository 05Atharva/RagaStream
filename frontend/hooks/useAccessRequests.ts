import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import Toast from '../services/toast';
import {
  applyDecision,
  isNotOwner,
  REQUESTS_POLL_MS,
  type OwnerRequests,
  type RequestAction,
} from '../services/accessRequests';
import { useAccess } from './useAccess';

const KEY = ['owner-requests'] as const;

/**
 * People waiting for the owner's approval, plus recent decisions. Key:
 * ['owner-requests']. Not saved to the phone (not in queryClient's SAVED).
 * Only runs for the owner. Pass `live` from a screen to also refetch every 60 s.
 */
export function useAccessRequests(options: { live?: boolean } = {}) {
  const access = useAccess();
  const isOwner = access.data?.is_owner === true;
  const query = useQuery({
    queryKey: KEY,
    enabled: isOwner,
    staleTime: 0,
    // A 403 not_owner is final; one retry for everything else.
    retry: (count, error) => !isNotOwner(error) && count < 1,
    refetchInterval: options.live ? REQUESTS_POLL_MS : false,
    queryFn: async () => (await apiClient.get<OwnerRequests>('/owner/requests')).data,
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (isOwner) void refetch();
    }, [isOwner, refetch])
  );
  return { ...query, isOwner, accessLoading: access.isLoading };
}

type Vars = { userId: string; email: string | null; action: RequestAction };

/** Approve or decline (or flip an earlier decision) with an optimistic move and rollback. */
export function useDecideRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, action }: Vars) =>
      (await apiClient.post<{ user_id: string; status: string }>(`/owner/requests/${userId}`, { action })).data,
    onMutate: async ({ userId, action }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<OwnerRequests>(KEY);
      if (previous) qc.setQueryData<OwnerRequests>(KEY, applyDecision(previous, userId, action));
      return { previous };
    },
    onError: (_err, { email, action }, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
      Toast.show({
        type: 'error',
        text1: `Couldn't ${action === 'approve' ? 'approve' : 'decline'} ${email ?? 'this person'}`,
        text2: 'Check your connection and try again.',
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
