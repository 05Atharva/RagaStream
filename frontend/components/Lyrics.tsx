import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { activeLineIndex, type Lyrics } from '../hooks/useLyrics';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { Colors, TypeScale } from '../constants/theme';

const PREVIEW_LINES = 5;

type CardProps = {
  lyrics: Lyrics | null | undefined;
  isLoading: boolean;
  isError: boolean;
  accent: string;
  onExpand: () => void;
};

/** Compact lyrics preview shown below the Now Playing controls. */
export function LyricsCard({ lyrics, isLoading, isError, accent, onExpand }: CardProps) {
  const position = usePlayerStore((state) => state.currentPosition);
  const lines = lyrics?.lines ?? [];
  const active = lyrics?.synced ? activeLineIndex(lines, position) : -1;

  const preview = useMemo(() => {
    if (!lyrics) return [];
    if (!lyrics.synced) {
      return (lyrics.plain ?? '').split('\n').filter(Boolean).slice(0, PREVIEW_LINES).map((text, i) => ({ text, index: i }));
    }
    const start = Math.max(0, Math.min(active, lines.length - PREVIEW_LINES));
    return lines.slice(start, start + PREVIEW_LINES).map((line, i) => ({ text: line.text || '♪', index: start + i }));
  }, [lyrics, lines, active]);

  return (
    <Pressable onPress={lyrics ? onExpand : undefined} style={[styles.card, { backgroundColor: accent }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Lyrics</Text>
        {lyrics ? (
          <View style={styles.expandButton}>
            <Text style={styles.expandText}>Show</Text>
            <Ionicons name="expand-outline" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      {isLoading ? (
        <ActivityIndicator color="#FFFFFF" style={styles.cardLoader} />
      ) : !lyrics ? (
        <Text style={styles.cardEmpty}>
          {isError ? "Couldn't load lyrics right now. Try again later." : "We don't have lyrics for this one yet."}
        </Text>
      ) : (
        preview.map((line) => (
          <Text
            key={line.index}
            numberOfLines={2}
            style={[styles.cardLine, lyrics.synced && line.index === active ? styles.cardLineActive : null]}
          >
            {line.text}
          </Text>
        ))
      )}
    </Pressable>
  );
}

type ViewProps = {
  visible: boolean;
  onClose: () => void;
  lyrics: Lyrics | null | undefined;
  background: string;
  title: string;
  artist: string;
};

/** Full-screen lyrics: synced lines auto-scroll; tap a line to seek to it. */
export function LyricsView({ visible, onClose, lyrics, background, title, artist }: ViewProps) {
  const position = usePlayerStore((state) => state.currentPosition);
  const listRef = useRef<FlatList>(null);
  const lines = useMemo(() => {
    if (!lyrics) return [];
    if (lyrics.synced) return lyrics.lines;
    return (lyrics.plain ?? '').split('\n').map((text) => ({ time: -1, text }));
  }, [lyrics]);
  const active = lyrics?.synced ? activeLineIndex(lines, position) : -1;

  useEffect(() => {
    if (!visible || active < 0) return;
    listRef.current?.scrollToIndex({ index: active, viewPosition: 0.35, animated: true });
  }, [active, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <LinearGradient colors={[background, '#000000']} locations={[0, 0.9]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={styles.viewContainer}>
        <View style={styles.viewHeader}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.viewClose}>
            <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles.viewHeaderText}>
            <Text numberOfLines={1} style={styles.viewTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.viewArtist}>{artist}</Text>
          </View>
          <View style={styles.viewClose} />
        </View>
        <FlatList
          ref={listRef}
          data={lines}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.viewList}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.35, animated: false }), 100);
          }}
          renderItem={({ item, index }) => (
            <Pressable
              disabled={!lyrics?.synced}
              onPress={() => void playback.seek(item.time)}
              style={styles.viewLinePress}
            >
              <Text
                style={[
                  styles.viewLine,
                  lyrics?.synced && index <= active ? styles.viewLineSung : null,
                  !lyrics?.synced ? styles.viewLinePlain : null,
                ]}
              >
                {item.text || '♪'}
              </Text>
            </Pressable>
          )}
          ListFooterComponent={
            lyrics ? (
              <Text style={styles.viewSource}>
                {lyrics.synced ? '' : 'These lyrics aren’t synced to the song yet.\n'}Lyrics provided by {lyrics.source}
              </Text>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    marginHorizontal: 16,
    minHeight: 180,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  expandButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  expandText: {
    color: '#FFFFFF',
    fontSize: TypeScale.caption,
    fontWeight: '700',
  },
  cardLoader: {
    marginTop: 32,
  },
  cardEmpty: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: TypeScale.body,
    lineHeight: 24,
  },
  cardLine: {
    color: 'rgba(0,0,0,0.55)',
    fontSize: TypeScale.title,
    fontWeight: '700',
    lineHeight: 28,
  },
  cardLineActive: {
    color: '#FFFFFF',
  },
  viewContainer: {
    flex: 1,
  },
  viewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  viewClose: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  viewHeaderText: {
    alignItems: 'center',
    flex: 1,
  },
  viewTitle: {
    color: '#FFFFFF',
    fontSize: TypeScale.body,
    fontWeight: '700',
  },
  viewArtist: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
  },
  viewList: {
    paddingBottom: 120,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  viewLinePress: {
    paddingVertical: 6,
  },
  viewLine: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: TypeScale.heading,
    fontWeight: '700',
    lineHeight: 32,
  },
  viewLineSung: {
    color: '#FFFFFF',
  },
  viewLinePlain: {
    color: '#FFFFFF',
    fontSize: TypeScale.title,
    lineHeight: 28,
  },
  viewSource: {
    color: Colors.textMuted,
    fontSize: TypeScale.small,
    marginTop: 32,
  },
});
