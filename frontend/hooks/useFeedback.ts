import { useQuery } from '@tanstack/react-query';
import { getFeedback, type Feedback } from '../services/recsService';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';

/** What the listener asked us not to recommend. Shared cache key: ['feedback']. */
export function useFeedback() {
  const signedIn = useAuthStore((s) => Boolean(s.session));
  return useQuery({
    queryKey: ['feedback'],
    enabled: signedIn,
    queryFn: async () => {
      const items = await getFeedback();
      // Pick up hides made on another device so offline fallbacks honour them too.
      const settings = useSettingsStore.getState();
      if (settings.feedbackSynced) {
        const songs = items.filter((f) => f.target_type === 'song').map((f) => f.target_id);
        const channels = items.filter((f) => f.target_type === 'channel').map((f) => f.target_id);
        useSettingsStore.setState({
          hiddenYoutubeIds: [...new Set([...settings.hiddenYoutubeIds, ...songs])],
          hiddenChannels: [...new Set([...settings.hiddenChannels, ...channels])],
        });
      }
      return items;
    },
  });
}

export function countFeedback(items: Feedback[]) {
  return {
    songs: items.filter((f) => f.target_type === 'song').length,
    channels: items.filter((f) => f.target_type === 'channel').length,
  };
}
