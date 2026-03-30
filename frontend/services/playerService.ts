import TrackPlayer, { Event } from 'react-native-track-player';
import Toast from 'react-native-toast-message';

export default async function playerService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void TrackPlayer.skipToPrevious();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    void TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, async () => {
    const track = await TrackPlayer.getActiveTrack();
    const youtubeId =
      (track as Record<string, unknown>)?.youtubeId as string | undefined ??
      (track as Record<string, unknown>)?.youtube_id as string | undefined;

    if (!track || !youtubeId) {
      return;
    }

    const apiBase = process.env.EXPO_PUBLIC_API_URL;
    if (!apiBase) {
      return;
    }

    Toast.show({ type: 'info', text1: 'Reconnecting...', visibilityTime: 2000 });

    try {
      const { position } = await TrackPlayer.getProgress();
      const res = await fetch(`${apiBase}/youtube/stream?id=${youtubeId}`);
      const data = await res.json() as { stream_url?: string };
      if (!data?.stream_url) {
        throw new Error('Missing stream URL');
      }

      const index = await TrackPlayer.getActiveTrackIndex();
      if (index === undefined || index < 0) {
        throw new Error('No active track index');
      }

      await TrackPlayer.remove(index);
      await TrackPlayer.add({ ...track, url: data.stream_url }, index);
      await TrackPlayer.skip(index);
      await TrackPlayer.seekTo(position);
      await TrackPlayer.play();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not reconnect. Try playing again.' });
    }
  });
}
