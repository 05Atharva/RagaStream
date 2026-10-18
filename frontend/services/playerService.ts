import TrackPlayer, { Event } from '../services/trackPlayerShim';
import * as playback from './playbackController';

/**
 * RNTP playback service: lock-screen, notification and Bluetooth controls.
 * Everything routes through playbackController so remote next/previous walk
 * the same queue as the in-app buttons. Stream-expiry recovery is handled by
 * the controller via the audio engine's PlaybackError listener.
 */
export default async function playerService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void playback.togglePlay();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void playback.togglePlay();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void playback.next();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void playback.previous();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void playback.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    void playback.seek(event.position);
  });
}
