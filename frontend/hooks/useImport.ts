import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from '../services/toast';
import { apiClient } from '../services/apiClient';
import { invalidatePlaylists } from '../services/libraryActions';
import { isRunning, type ImportJob, type ImportPreview, type ImportRequest } from '../services/importLogic';
import { useImportStore } from '../store/importStore';

export const IMPORT_POLL_MS = 1500;

/** Read a link or song list and say what is in it. Nothing is saved yet. */
export function useImportPreview() {
  return useMutation({
    mutationFn: async (request: ImportRequest) => {
      const { data } = await apiClient.post<ImportPreview>('/import/preview', request);
      return data;
    },
  });
}

/** Start matching the songs and building the playlist on the server. */
export function useStartImport() {
  return useMutation({
    mutationFn: async (body: ImportRequest & { name?: string; description?: string | null }) => {
      const { data } = await apiClient.post<{ job_id: string }>('/import/jobs', body);
      return data.job_id;
    },
  });
}

/**
 * One import job, polled every 1.5 s while it runs. Key: ['import-job', id].
 * Not in queryClient's SAVED list: a job is only meaningful while it runs.
 */
export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['import-job', jobId],
    enabled: Boolean(jobId),
    staleTime: 0,
    retry: 2,
    refetchInterval: (q) => (q.state.status === 'error' && !q.state.data ? false : isRunning(q.state.data?.status) || !q.state.data ? IMPORT_POLL_MS : false),
    queryFn: async () => {
      const { data } = await apiClient.get<ImportJob>(`/import/jobs/${jobId}`);
      return data;
    },
  });
}

export async function cancelImportJob(jobId: string): Promise<void> {
  await apiClient.post(`/import/jobs/${jobId}/cancel`);
}

/**
 * Keeps the active job polling no matter which screen is open, moves the flow
 * to "done" and refreshes the library when it finishes. Mounted once, inside
 * the signed-in app. Returns nothing; the Import screen reads the same query.
 */
export function useImportWatcher() {
  const jobId = useImportStore((s) => s.flow.jobId);
  const query = useImportJob(jobId);
  const job = query.data;

  useEffect(() => {
    if (!job || !jobId) return;
    const { dispatch, screenFocused, announcedJobId, markAnnounced } = useImportStore.getState();
    if (job.status === 'done') {
      dispatch({ type: 'finished' });
      invalidatePlaylists(job.playlist_id ? [job.playlist_id] : []);
      if (announcedJobId !== jobId) {
        markAnnounced(jobId);
        if (!screenFocused) {
          Toast.show({ type: 'success', text1: `${job.name} is ready`, text2: 'Open Library to listen.' });
        }
      }
    } else if (job.status === 'failed' && announcedJobId !== jobId) {
      markAnnounced(jobId);
      if (!screenFocused) {
        Toast.show({ type: 'error', text1: `Couldn't import ${job.name}`, text2: job.error ?? 'Open Import to try again.' });
      }
    }
  }, [job, jobId]);

  return query;
}
