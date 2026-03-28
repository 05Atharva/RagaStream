import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';

export type YouTubeVideo = {
  id: string;
  title: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  duration?: string;
};

export function useYouTube(youtubeId: string) {
  return useQuery({
    queryKey: ['youtube', youtubeId],
    enabled: youtubeId.trim().length > 0,
    queryFn: async () => {
      const { data } = await apiClient.get<YouTubeVideo>(`/youtube/${youtubeId}`);
      return data;
    },
  });
}

export function useResolveYouTube() {
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await apiClient.post<YouTubeVideo>('/youtube/resolve', {
        url,
      });
      return data;
    },
  });
}
