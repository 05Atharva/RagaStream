import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { activeLineIndex, type Lyrics } from '../hooks/useLyrics';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { Layout, Radius, Space } from '../constants/theme';
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
  onExpand: () => void;
};

/** Lyrics preview below the Now Playing controls; the sung line lights up. */
export function LyricsCard({ lyrics, isLoading, isError, background, ink, dim, onExpand }: CardProps) {
  const position = usePlayerStore((s) => s.currentPosition);
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
    <Pressable
      onPress={lyrics ? onExpand : undefined}
      accessibilityRole={lyrics ? 'button' : undefined}
      accessibilityLabel={lyrics ? 'Open full lyrics' : undefined}
      style={{ backgroundColor: background, borderRadius: Radius.lg, marginHorizontal: Layout.gutter, minHeight: 184, padding: Space[5], gap: Space[2] }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: Space[2] }}>
        <Text variant="label" color={ink}>Lyrics</Text>
        {lyrics ? <Ionicons name="expand" size={16} color={ink} /> : null}
      </View>
      {isLoading ? (
        <ActivityIndicator color={ink} style={{ marginTop: Space[8] }} />
      ) : !lyrics ? (
        <Text variant="body" color={dim}>
          {isError ? "Lyrics couldn't load right now. They'll be back shortly." : "We don't have lyrics for this one yet."}
        </Text>
      ) : (
        preview.map((line) => (
          <Text
            key={line.index}
            variant="title"
            numberOfLines={2}
            color={lyrics.synced && line.index !== active ? dim : ink}
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
