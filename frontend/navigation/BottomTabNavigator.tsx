import { View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MiniPlayer from '../components/MiniPlayer';
import OfflineState from '../components/OfflineState';
import TabBar from '../components/TabBar';
import { Layout } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';
import { queryClient } from '../services/queryClient';
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

export default function BottomTabNavigator() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;
  const hasTrack = usePlayerStore((state) => state.currentTrack !== null);
  const aboveTabs = insets.bottom + Layout.tabBarHeight;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tab.Navigator
        tabBar={(props) => <TabBar {...props} />}
        sceneContainerStyle={{ backgroundColor: colors.bg }}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Search" component={SearchScreen} />
        <Tab.Screen name="Library" component={LibraryScreen} />
      </Tab.Navigator>

      {isOffline ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: aboveTabs }}>
          <OfflineState onRetry={() => void queryClient.refetchQueries({ type: 'active' })} />
        </View>
      ) : null}

      {hasTrack ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: aboveTabs }}>
          <MiniPlayer onOpenNowPlaying={() => navigation.navigate('NowPlaying')} />
        </View>
      ) : null}
    </View>
  );
}
