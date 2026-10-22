import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHome, isHiddenLocally, type HomeRecs } from '../services/recsService';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Home sections from the recommendation engine, built for the current hour.
 * Cache key: ['recs-home', hour]; hides and feedback changes invalidate it.
 */
export function useHomeRecs() {
  const hour = new Date().getHours();
  const signedIn = useAuthStore((s) => Boolean(s.session));
  // Re-run the filter when the local hide lists change.
  const hiddenSongs = useSettingsStore((s) => s.hiddenYoutubeIds);
  const hiddenChannels = useSettingsStore((s) => s.hiddenChannels);

  const select = useCallback(
    (data: HomeRecs): HomeRecs => ({
      ...data,
      sections: data.sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => !isHiddenLocally(item.youtube_id, item.channel)),
        }))
        .filter((section) => section.items.length > 0),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hiddenSongs, hiddenChannels],
  );

  return useQuery({
    queryKey: ['recs-home', hour],
    enabled: signedIn,
    queryFn: () => fetchHome(hour),
    staleTime: 15 * 60 * 1000,
    select,
  });
}
