/**
 * queryClient.ts
 *
 * Shared react-query client instance.
 * Exported separately so any module (screens, services) can call
 * queryClient.invalidateQueries() after mutations without needing
 * the useQueryClient() hook (which requires a component context).
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds — keeps data fresh across tab switches
    },
  },
});
