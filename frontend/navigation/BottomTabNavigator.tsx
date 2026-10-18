import React from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MiniPlayer from '../components/MiniPlayer';
import OfflineState from '../components/OfflineState';
import { queryClient } from '../services/queryClient';
import { Colors } from '../constants/theme';
import { tapHaptic } from '../services/haptics';
import type { RootStackParamList } from './RootNavigator';
import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import SearchScreen from '../screens/SearchScreen';
import { usePlayerStore } from '../store/playerStore';

export type BottomTabParamList = {
  Home: undefined;
  Search: { initialQuery?: string; autoSearch?: boolean } | undefined;
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
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;

  // The system navigation bar inset — ensures nothing overlaps Android's nav bar
  const bottomInset = insets.bottom;

  return (
    <View style={styles.container}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          sceneStyle: {
            backgroundColor: Colors.background,
          },
          // Content scrolls under a dark fade instead of a hard-edged bar.
          tabBarBackground: () => (
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)', '#000000']}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFillObject}
            />
          ),
          tabBarStyle: {
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            bottom: bottomInset,
            height: TAB_BAR_HEIGHT,
            left: 0,
            paddingBottom: 4,
            paddingTop: 4,
            position: 'absolute',
            right: 0,
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textSubdued,
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
        screenListeners={{ tabPress: () => tapHaptic() }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Library" component={LibraryScreen} />
      </Tab.Navigator>

      {isOffline ? (
        <View style={[styles.offlineOverlay, { bottom: bottomInset + TAB_BAR_HEIGHT }]}>
          <OfflineState onRetry={() => void queryClient.refetchQueries({ type: 'active' })} />
        </View>
      ) : null}

      {isMiniPlayerVisible ? (
        <View style={[styles.miniPlayerContainer, { bottom: bottomInset + TAB_BAR_HEIGHT }]}>
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
  offlineOverlay: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  miniPlayerContainer: {
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
