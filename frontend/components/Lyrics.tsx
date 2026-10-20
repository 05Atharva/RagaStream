import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { activeLineIndex, type Lyrics } from '../hooks/useLyrics';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { Layout, Radius, Space } from '../constants/theme';
import Rise from '../motion/Rise';
import IconButton from './ui/IconButton';
import Text from './ui/Text';

const PREVIEW_LINES = 5;

type CardProps = {
  lyrics: Lyrics | null | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Card fill (artwork-derived) and the text colours that read on it. */
  background: string;
  ink: string;
  dim: string;
  /** The "being sung" marker; the same colour as the elapsed seek line. */
  marker: string;
  onExpand: () => void;
};

/**
 * Lyrics as liner notes, below the Now Playing controls. The line being sung
 * is set larger with a marker beside it; each new line rises into place.
 */
export function LyricsCard({ lyrics, isLoading, isError, background, ink, dim, marker, onExpand }: CardProps) {
  const position = usePlayerStore((s) => s.currentPosition);
  const lines = lyrics?.lines ?? [];
  const active = lyrics?.synced ? activeLineIndex(lines, position) : -1;

  const { start, preview } = useMemo(() => {
    if (!lyrics) return { start: 0, preview: [] };
    if (!lyrics.synced) {
      const plain = (lyrics.plain ?? '').split('\n').filter(Boolean).slice(0, PREVIEW_LINES);
      return { start: 0, preview: plain.map((text, i) => ({ text, index: i })) };
    }
    // One sung line above the current one, the rest below it.
    const from = Math.max(0, Math.min(active - 1, lines.length - PREVIEW_LINES));
    return { start: from, preview: lines.slice(from, from + PREVIEW_LINES).map((line, i) => ({ text: line.text || '♪', index: from + i })) };
  }, [lyrics, lines, active]);

  const status = !lyrics ? null : lyrics.synced ? `Synced · ${lyrics.source}` : `Not synced · ${lyrics.source}`;

  return (
    <Pressable
      onPress={lyrics ? onExpand : undefined}
      accessibilityRole={lyrics ? 'button' : undefined}
      accessibilityLabel={lyrics ? 'Lyrics. Open full lyrics' : undefined}
      style={{ backgroundColor: background, borderRadius: Radius.lg, gap: Space[3], marginHorizontal: Layout.gutter, marginTop: Space[4], padding: Space[5] }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3] }}>
        <Text variant="label" color={ink} style={{ flex: 1 }}>Lyrics</Text>
        {status ? <Text variant="mono" color={ink} numberOfLines={1}>{status}</Text> : null}
      </View>

      {isLoading ? (
        <ActivityIndicator color={ink} style={{ marginVertical: Space[8] }} />
      ) : !lyrics ? (
        <Text variant="body" color={dim}>
          {isError ? "Lyrics couldn't load right now. Check your connection, then reopen this song." : "We don't have lyrics for this one yet."}
        </Text>
      ) : (
        <Rise key={lyrics.synced ? start : 'plain'} style={{ gap: Space[2], minHeight: 176 }}>
          {preview.map((line) => {
            const isActive = lyrics.synced && line.index === active;
            return (
              <View key={line.index} style={{ flexDirection: 'row', gap: Space[3] }}>
                <View style={{ backgroundColor: isActive ? marker : 'transparent', borderRadius: Radius.pill, width: 3 }} />
                <Text
                  variant={isActive ? 'headline' : 'title'}
                  numberOfLines={2}
                  color={!lyrics.synced || isActive ? ink : dim}
                  style={{ flex: 1 }}
                >
                  {line.text}
                </Text>
              </View>
            );
          })}
        </Rise>
      )}

      {lyrics ? (
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[2], minHeight: Layout.touchTarget }}>
          <Text variant="captionStrong" color={ink}>Open full lyrics</Text>
          <Ionicons name="arrow-forward" size={16} color={ink} />
        </View>
      ) : null}
    </Pressable>
  );
}

type ViewProps = {
  visible: boolean;
  onClose: () => void;
  lyrics: Lyrics | null | undefined;
  background: string;
  base: string;
  ink: string;
  dim: string;
  title: string;
  artist: string;
};

/** Full-screen lyrics: synced lines follow the song; tap a line to jump there. */
export function LyricsView({ visible, onClose, lyrics, background, base, ink, dim, title, artist }: ViewProps) {
  const position = usePlayerStore((s) => s.currentPosition);
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
      <LinearGradient colors={[background, base]} locations={[0, 0.85]} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', paddingHorizontal: Space[2], paddingVertical: Space[2] }}>
            <IconButton icon="chevron-down" onPress={onClose} accessibilityLabel="Close lyrics" color={ink} iconSize={26} />
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text variant="subtitle" color={ink} numberOfLines={1}>{title}</Text>
              <Text variant="caption" color={dim} numberOfLines={1}>{artist}</Text>
            </View>
            <View style={{ width: Layout.touchTarget }} />
          </View>
          <FlatList
            ref={listRef}
            data={lines}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={{ paddingBottom: 160, paddingHorizontal: Space[6], paddingTop: Space[6] }}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={({ index }) => {
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.35, animated: false }), 100);
            }}
            renderItem={({ item, index }) => (
              <Pressable disabled={!lyrics?.synced} onPress={() => void playback.seek(item.time)} style={{ paddingVertical: Space[2] }}>
                <Text variant={lyrics?.synced ? 'headline' : 'title'} color={!lyrics?.synced || index <= active ? ink : dim}>
                  {item.text || '♪'}
                </Text>
              </Pressable>
            )}
            ListFooterComponent={
              lyrics ? (
                <Text variant="caption" color={dim} style={{ marginTop: Space[8] }}>
                  {lyrics.synced ? '' : "These lyrics aren't synced to the song yet.\n"}Lyrics from {lyrics.source}
                </Text>
              ) : null
            }
          />
        </SafeAreaView>
      </LinearGradient>
    </Modal>
  );
}
