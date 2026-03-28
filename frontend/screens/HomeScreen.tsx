import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { MotiView } from 'moti';
import { apiClient } from '../services/apiClient';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import type { Song } from '../hooks/useSongs';
import { useAuthStore } from '../store/authStore';

type Props = BottomTabScreenProps<BottomTabParamList, 'Home'>;

type YouTubeSearchResult = {
  youtube_id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
};

const GENRE_CHIPS = [
  { label: 'Bollywood', color: '#FF6B6B' },
  { label: 'Classical', color: '#4ECDC4' },
  { label: 'Folk', color: '#45B7D1' },
  { label: 'Devotional', color: '#FFA07A' },
  { label: 'Indie', color: '#98D8C8' },
  { label: 'Punjabi', color: '#FFD93D' },
  { label: 'Ghazals', color: '#C084FC' },
  { label: 'Sufi', color: '#86EFAC' },
] as const;

const FEATURED_QUERIES = [
  'Kesariya Arijit Singh',
  'Kun Faya Kun A.R. Rahman',
  'Pasoori Ali Sethi',
  'Madhubala Amit Trivedi',
];

function getGreeting(displayName?: string | null) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const name = displayName?.trim() || 'Listener';
  return `Good ${part}, ${name}`;
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function SkeletonBlock({
  width,
  height,
  borderRadius = BorderRadius.lg,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
}) {
  return (
    <MotiView
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.85 }}
      transition={{ type: 'timing', duration: 900, loop: true }}
      style={[styles.skeleton, { width, height, borderRadius }]}
    />
  );
}

export default function HomeScreen({ navigation }: Props) {
  const session = useAuthStore((state) => state.session);
  const displayName =
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    session?.user?.email?.split('@')[0] ||
    'Listener';

  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/history');
      return data.slice(0, 10);
    },
  });

  const likedQuery = useQuery({
    queryKey: ['liked'],
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/liked');
      return data.slice(0, 6);
    },
  });

  const fallbackQuickPicksQuery = useQuery({
    queryKey: ['songs', 'quick-picks-fallback'],
    enabled: likedQuery.isSuccess && likedQuery.data.length === 0,
    queryFn: async () => {
      const { data } = await apiClient.get<Song[]>('/songs', {
        params: { limit: 6 },
      });
      return data;
    },
  });

  const featuredQueries = useQueries({
    queries: FEATURED_QUERIES.map((q) => ({
      queryKey: ['featured', q],
      queryFn: async () => {
        const { data } = await apiClient.get<YouTubeSearchResult[]>('/youtube/search', {
          params: { q, limit: 1 },
        });
        return data[0] ?? null;
      },
    })),
  });

  const quickPicks = useMemo(() => {
    if ((likedQuery.data?.length ?? 0) > 0) {
      return likedQuery.data ?? [];
    }
    return fallbackQuickPicksQuery.data ?? [];
  }, [fallbackQuickPicksQuery.data, likedQuery.data]);

  const featuredCards = featuredQueries
    .map((query) => query.data)
    .filter((item): item is YouTubeSearchResult => Boolean(item));

  const isQuickPicksLoading =
    likedQuery.isLoading || (likedQuery.isSuccess && likedQuery.data.length === 0 && fallbackQuickPicksQuery.isLoading);

  const isHistoryLoading = historyQuery.isLoading;
  const isFeaturedLoading = featuredQueries.some((query) => query.isLoading);
  const avatarLetter = displayName.charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>{getGreeting(displayName)}</Text>
            <Text style={styles.headerSubtitle}>Your stream starts where you left it.</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Quick Picks" />
          {isQuickPicksLoading ? (
            <View style={styles.quickPicksSkeletonGrid}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View key={index} style={styles.quickPickCard}>
                  <SkeletonBlock width="100%" height={110} />
                  <SkeletonBlock width="78%" height={14} borderRadius={6} />
                  <SkeletonBlock width="56%" height={12} borderRadius={6} />
                </View>
              ))}
            </View>
          ) : (
            <FlashList
              data={quickPicks}
              keyExtractor={(item) => item.id}
              numColumns={2}
              estimatedItemSize={220}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.quickPickCard}>
                  <Image
                    source={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined}
                    style={styles.quickPickThumb}
                    contentFit="cover"
                  />
                  <Text numberOfLines={1} style={styles.cardTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.cardSubtitle}>
                    {item.channel_name || 'Unknown channel'}
                  </Text>
                </View>
              )}
            />
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader title="Recently Played" />
          {isHistoryLoading ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.rowGap}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <View key={index} style={styles.historyCard}>
                    <SkeletonBlock width={80} height={80} />
                    <SkeletonBlock width={72} height={12} borderRadius={6} />
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <FlashList
              horizontal
              data={historyQuery.data ?? []}
              keyExtractor={(item) => item.id}
              estimatedItemSize={110}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <Image
                    source={item.thumbnail_url ? { uri: item.thumbnail_url } : undefined}
                    style={styles.historyThumb}
                    contentFit="cover"
                  />
                  <Text numberOfLines={2} style={styles.historyTitle}>
                    {item.title}
                  </Text>
                </View>
              )}
            />
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader title="Genre Shortcuts" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {GENRE_CHIPS.map((chip) => (
              <Pressable
                key={chip.label}
                onPress={() =>
                  navigation.navigate('Search', {
                    initialQuery: chip.label,
                    autoSearch: true,
                  })
                }
                style={[styles.genreChip, { backgroundColor: chip.color }]}
              >
                <Text style={styles.genreChipText}>{chip.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Featured Today" />
          {isFeaturedLoading ? (
            <View style={styles.featuredList}>
              {Array.from({ length: 4 }).map((_, index) => (
                <View key={index} style={styles.featuredCard}>
                  <SkeletonBlock width="100%" height={160} />
                  <SkeletonBlock width="72%" height={16} borderRadius={6} />
                  <SkeletonBlock width="48%" height={12} borderRadius={6} />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.featuredList}>
              {featuredCards.map((item) => (
                <View key={item.youtube_id} style={styles.featuredCard}>
                  <Image
                    source={item.thumbnail ? { uri: item.thumbnail } : undefined}
                    style={styles.featuredThumb}
                    contentFit="cover"
                  />
                  <Text numberOfLines={2} style={styles.featuredTitle}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.featuredSubtitle}>
                    {item.channel}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 140,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
  },
  headerCopy: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  greeting: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
  },
  headerSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 6,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#2A2238',
    borderRadius: BorderRadius.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarText: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeLg,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.md,
  },
  quickPicksSkeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickPickCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    padding: Spacing.sm,
    width: '48.2%',
  },
  quickPickThumb: {
    borderRadius: BorderRadius.lg,
    height: 110,
    width: '100%',
  },
  cardTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemiBold,
  },
  cardSubtitle: {
    color: Colors.muted,
    fontSize: 12,
  },
  rowGap: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  historyCard: {
    marginRight: Spacing.md,
    width: 90,
  },
  historyThumb: {
    borderRadius: BorderRadius.lg,
    height: 80,
    marginBottom: Spacing.sm,
    width: 80,
  },
  historyTitle: {
    color: Colors.onBackground,
    fontSize: 12,
    lineHeight: 16,
    width: 80,
  },
  chipsRow: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  genreChip: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  genreChipText: {
    color: '#111111',
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightBold,
  },
  featuredList: {
    gap: Spacing.md,
  },
  featuredCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    padding: Spacing.sm,
  },
  featuredThumb: {
    borderRadius: BorderRadius.lg,
    height: 160,
    marginBottom: Spacing.md,
    width: '100%',
  },
  featuredTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
  featuredSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  skeleton: {
    backgroundColor: '#3A3A3A',
  },
});
