import TrackPlayer, { Event } from 'react-native-track-player';

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
}
