import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import type { Song } from './useSongs';

export type SearchResult = {
  songs: Song[];
};

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    enabled: query.trim().length > 0,
    queryFn: async () => {
      const { data } = await apiClient.get<SearchResult>('/search', {
        params: { q: query },
      });
      return data;
    },
  });
}

export function useSearchMutation() {
  return useMutation({
    mutationFn: async (query: string) => {
      const { data } = await apiClient.get<SearchResult>('/search', {
        params: { q: query },
      });
      return data;
    },
  });
}
