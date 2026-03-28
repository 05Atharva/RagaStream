import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import type { BottomTabParamList } from '../navigation/BottomTabNavigator';
import { useSearch } from '../hooks/useSearch';

type Props = BottomTabScreenProps<BottomTabParamList, 'Search'>;

export default function SearchScreen({ route }: Props) {
  const [query, setQuery] = useState(route.params?.initialQuery ?? '');
  const { data, isLoading, isFetching } = useSearch(query);

  useEffect(() => {
    if (route.params?.initialQuery) {
      setQuery(route.params.initialQuery);
    }
  }, [route.params?.initialQuery]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Search</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search songs, artists, genres"
          placeholderTextColor={Colors.muted}
          style={styles.input}
        />

        {isLoading || isFetching ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : null}

        {query.trim().length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.subtitle}>Discover ragas, artists, and albums</Text>
          </View>
        ) : (
          <View style={styles.results}>
            {(data?.songs ?? []).map((song) => (
              <Pressable key={song.id} style={styles.resultRow}>
                <Text numberOfLines={1} style={styles.resultTitle}>
                  {song.title}
                </Text>
                <Text numberOfLines={1} style={styles.resultSubtitle}>
                  {song.channel_name || 'Unknown channel'}
                </Text>
              </Pressable>
            ))}

            {!isLoading && (data?.songs?.length ?? 0) === 0 ? (
              <Text style={styles.emptyText}>No songs found for "{query}".</Text>
            ) : null}
          </View>
        )}
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
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  title: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXxl,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  subtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    textAlign: 'center',
  },
  results: {
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  resultRow: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  resultTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  resultSubtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    marginTop: 4,
  },
  emptyText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
});
