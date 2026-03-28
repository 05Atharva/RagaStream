import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MiniPlayer, { MINI_PLAYER_HEIGHT } from '../components/MiniPlayer';
import { Colors } from '../constants/theme';
import type { RootStackParamList } from './RootNavigator';
import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import SearchScreen from '../screens/SearchScreen';
import { usePlayerStore } from '../store/playerStore';

export type BottomTabParamList = {
  Home: undefined;
  Search: undefined;
  Library: undefined;
};

const Tab = createBottomTabNavigator<BottomTabParamList>();
const TAB_BAR_HEIGHT = 60;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, { active: IoniconName; inactive: IoniconName }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Search: { active: 'search', inactive: 'search-outline' },
  Library: { active: 'library', inactive: 'library-outline' },
};

export default function BottomTabNavigator() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isMiniPlayerVisible = currentTrack !== null;

  return (
    <View style={styles.container}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          sceneStyle: {
            backgroundColor: Colors.background,
          },
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
            borderTopWidth: 1,
            bottom: isMiniPlayerVisible ? MINI_PLAYER_HEIGHT : 0,
            height: TAB_BAR_HEIGHT,
            left: 0,
            paddingBottom: 4,
            paddingTop: 4,
            position: 'absolute',
            right: 0,
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.muted,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: 2,
          },
          tabBarIcon: ({ focused, color, size }) => {
            const icons = TAB_ICONS[route.name];
            const iconName = focused ? icons.active : icons.inactive;
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Library" component={LibraryScreen} />
      </Tab.Navigator>

      {isMiniPlayerVisible ? (
        <View style={styles.miniPlayerContainer}>
          <MiniPlayer onOpenNowPlaying={() => navigation.navigate('NowPlaying')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  miniPlayerContainer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
