import { registerRootComponent } from 'expo';
import App from './App';

try {
  const TrackPlayer = require('react-native-track-player').default;
  TrackPlayer.registerPlaybackService(() => require('./services/playerService').default);
} catch {
  // Expo Go doesn't include TrackPlayer, so skip service registration there.
}

registerRootComponent(App);
