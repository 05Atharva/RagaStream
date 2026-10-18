import React from 'react';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BottomTabNavigator, { type BottomTabParamList } from './BottomTabNavigator';
import ChannelScreen from '../screens/ChannelScreen';
import LikedSongsScreen from '../screens/LikedSongsScreen';
import NowPlayingScreen from '../screens/NowPlayingScreen';
import PlaylistScreen from '../screens/PlaylistScreen';
import SettingsScreen from '../screens/SettingsScreen';
import StatsScreen from '../screens/StatsScreen';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<BottomTabParamList> | undefined;
  NowPlaying: undefined;
  Settings: undefined;
  LikedSongs: undefined;
  Playlist: { playlistId: string };
  Channel: { channelName: string };
  Stats: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={BottomTabNavigator} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="LikedSongs" component={LikedSongsScreen} />
      <Stack.Screen name="Playlist" component={PlaylistScreen} />
      <Stack.Screen name="Channel" component={ChannelScreen} />
      <Stack.Screen name="Stats" component={StatsScreen} />
      <Stack.Screen
        name="NowPlaying"
        component={NowPlayingScreen}
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack.Navigator>
  );
}
