import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import EqualizerBars from './EqualizerBars';
import { usePlayerStore, type Track } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { openSongMenu } from '../store/songMenuStore';
import { gestureHaptic, tapHaptic } from '../services/haptics';
import { Colors, TypeScale } from '../constants/theme';

type QueueSheetProps = {
  isVisible: boolean;
  onClose: () => void;
};

function QueueRow({
  track,
  onPress,
  onLongPress,
  isCurrent = false,
  isPlaying = false,
  draggable = false,
}: {
  track: Track;
  onPress?: () => void;
  onLongPress?: () => void;
  isCurrent?: boolean;
  isPlaying?: boolean;
  draggable?: boolean;
}) {
  const thumbnail = track.thumbnail_url || track.thumbnailUrl || track.artwork;
  const channel = track.channel_name || track.channelName || track.artist;

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={200}
      style={({ pressed }) => [styles.row, pressed && !isCurrent && styles.rowPressed]}
    >
      <View style={styles.thumbWrap}>
        {thumbnail ? <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFillObject} contentFit="cover" /> : null}
        {isCurrent ? (
          <View style={styles.thumbOverlay}>
            <EqualizerBars isPlaying={isPlaying} size="sm" />
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, isCurrent && styles.titleCurrent]}>
          {track.title}
        </Text>
        <View style={styles.subtitleRow}>
          {track.isRecommendation ? <Ionicons name="sparkles" size={12} color={Colors.secondary} /> : null}
          <Text numberOfLines={1} style={styles.subtitle}>{channel}</Text>
        </View>
      </View>
      {!isCurrent ? (
        <Pressable
          hitSlop={8}
          onPress={() => openSongMenu(playback.trackToSong(track), { queueTrack: track })}
          style={styles.iconButton}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textMuted} />
        </Pressable>
      ) : null}
      {draggable ? <Ionicons name="reorder-three" size={22} color={Colors.textMuted} /> : null}
    </Pressable>
  );

  if (isCurrent || !track.queueId) return row;
  return (
    <Swipeable
      renderRightActions={() => (
        <View style={styles.deleteAction}>
          <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
        </View>
      )}
      onSwipeableOpen={() => {
        gestureHaptic();
        playback.removeFromQueue(track.queueId!);
      }}
    >
      {row}
    </Swipeable>
  );
}

export default function QueueSheet({ isVisible, onClose }: QueueSheetProps) {
  const { height } = useWindowDimensions();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const context = usePlayerStore((s) => s.context);

  const upcoming = queue.slice(currentIndex + 1);
  const contextUpcoming = upcoming.filter((t) => !t.isAutoplay);
  const autoplayUpcoming = upcoming.filter((t) => t.isAutoplay);

  const play = (track: Track) => {
    tapHaptic();
    if (track.queueId) void playback.playQueueItem(track.queueId);
  };

  const renderContextItem = ({ item, drag, isActive }: RenderItemParams<Track>) => (
    <ScaleDecorator>
      <View style={{ opacity: isActive ? 0.85 : 1 }}>
        <QueueRow track={item} onPress={() => play(item)} onLongPress={drag} draggable />
      </View>
    </ScaleDecorator>
  );

  const header = (
    <View>
      {currentTrack ? (
        <>
          <Text style={styles.sectionLabel}>Now playing</Text>
          <QueueRow track={currentTrack} isCurrent isPlaying={isPlaying} />
        </>
      ) : null}

      {userQueue.length > 0 ? (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Next in queue</Text>
            <Pressable onPress={playback.clearUserQueue} hitSlop={8} style={styles.clearButton}>
              <Text style={styles.clearText}>Clear queue</Text>
            </Pressable>
          </View>
          {userQueue.map((track) => (
            <QueueRow key={track.queueId} track={track} onPress={() => play(track)} />
          ))}
        </>
      ) : null}

      {contextUpcoming.length > 0 ? (
        <Text style={styles.sectionLabel}>
          Next from: <Text style={styles.sectionContext}>{context?.name ?? 'your queue'}</Text>
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <View>
      {autoplayUpcoming.length > 0 ? (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Autoplay</Text>
            <Text style={styles.autoplayHint}>Similar music</Text>
          </View>
          {autoplayUpcoming.slice(0, 15).map((track) => (
            <QueueRow key={track.queueId} track={track} onPress={() => play(track)} />
          ))}
        </>
      ) : null}
      {upcoming.length === 0 && userQueue.length === 0 ? (
        <Text style={styles.emptyText}>Nothing queued. Tap "Add to queue" from a song's menu.</Text>
      ) : null}
    </View>
  );

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose} backgroundColor="#121414">
      <View style={styles.container}>
        <Text style={styles.sheetTitle}>Queue</Text>
        <View style={{ height: height * 0.68 }}>
          <DraggableFlatList
            data={contextUpcoming}
            keyExtractor={(item) => item.queueId ?? item.id}
            renderItem={renderContextItem}
            onDragBegin={gestureHaptic}
            onDragEnd={({ data }) => playback.reorderUpcoming([...data, ...autoplayUpcoming])}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={styles.listContent}
          />
        </View>
      </View>
    </AnimatedBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
  },
  sheetTitle: {
    color: Colors.onBackground,
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 32,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
  },
  sectionContext: {
    color: Colors.primaryLight,
  },
  clearButton: {
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  clearText: {
    color: Colors.onBackground,
    fontSize: TypeScale.caption,
    fontWeight: '600',
  },
  autoplayHint: {
    color: Colors.textMuted,
    fontSize: TypeScale.small,
    marginTop: 8,
  },
  row: {
    alignItems: 'center',
    backgroundColor: '#121414',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  thumbWrap: {
    backgroundColor: '#262828',
    borderRadius: 8,
    height: 44,
    overflow: 'hidden',
    width: 44,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
  },
  titleCurrent: {
    color: Colors.primaryLight,
    fontWeight: '600',
  },
  subtitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  subtitle: {
    color: Colors.textSubdued,
    flexShrink: 1,
    fontSize: TypeScale.small,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  deleteAction: {
    alignItems: 'flex-end',
    backgroundColor: Colors.error,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    paddingRight: 20,
  },
  emptyText: {
    color: Colors.textMuted,
    paddingVertical: 24,
    textAlign: 'center',
  },
});
