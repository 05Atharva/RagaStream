import React, { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Swipeable } from 'react-native-gesture-handler';
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import EqualizerBars from './EqualizerBars';
import Button from './ui/Button';
import { SheetHeader } from './ui/SheetRow';
import Text from './ui/Text';
import { useRise } from '../motion/primitives';
import { usePlayerStore, type Track } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { openSongMenu } from '../store/songMenuStore';
import { gestureHaptic, tapHaptic } from '../services/haptics';
import { Layout, Motion, Radius, Space, type ThemeColors } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

type QueueSheetProps = {
  isVisible: boolean;
  onClose: () => void;
};

const ROW_H = 64;
const LABEL_H = 36;
const GUTTER = 28;
const LINE_W = 2;
const DASH = 4;
const PLAYED_COUNT = 3;

type Kind = 'played' | 'now' | 'user' | 'context' | 'autoplay';

/** Line draw: scaleY 0 to 1 from the top, glide curve, staggered by index. */
function useDraw(index: number, enabled: boolean) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(enabled && !reduced ? 0 : 1);
  useEffect(() => {
    if (!enabled || reduced) return;
    progress.value = withDelay(
      Math.min(index, Motion.staggerMax) * Motion.stagger,
      withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.glide }),
    );
    // Plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useAnimatedStyle(() => ({
    transform: [{ scaleY: progress.value }],
    transformOrigin: 'top',
  }));
}

/** The timeline segment for one row (or label): solid, or dashed for Autoplay. */
function Segment({ color, dashed, height, index, animate }: { color: string; dashed?: boolean; height: number; index: number; animate: boolean }) {
  const draw = useDraw(index, animate);
  const dashCount = Math.ceil(height / (DASH * 2));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { bottom: 0, left: (GUTTER - LINE_W) / 2, overflow: 'hidden', position: 'absolute', top: 0, width: LINE_W },
        draw,
      ]}
    >
      {dashed ? (
        Array.from({ length: dashCount }, (_, i) => (
          <View key={i} style={{ backgroundColor: color, height: DASH, marginBottom: DASH, width: LINE_W }} />
        ))
      ) : (
        <View style={{ backgroundColor: color, flex: 1 }} />
      )}
    </Animated.View>
  );
}

function Node({ kind, lineColor }: { kind: Kind; lineColor: string }) {
  const colors = useColors();
  const center = { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', top: 0, width: GUTTER } as const;
  if (kind === 'now') {
    return (
      <View style={center} pointerEvents="none">
        <View style={{ alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: 11, height: 22, justifyContent: 'center', width: 22 }}>
          <View style={{ backgroundColor: colors.accent, borderRadius: 7, height: 14, width: 14 }} />
        </View>
      </View>
    );
  }
  const filled = kind === 'user';
  return (
    <View style={center} pointerEvents="none">
      <View
        style={{
          backgroundColor: filled ? lineColor : colors.surface,
          borderColor: lineColor,
          borderRadius: 5,
          borderWidth: 2,
          height: 10,
          width: 10,
        }}
      />
    </View>
  );
}

function lineFor(kind: Kind, colors: ThemeColors) {
  switch (kind) {
    case 'played': return colors.textTertiary;
    case 'now': return colors.accent;
    case 'user': return colors.signal;
    default: return colors.border;
  }
}

/** Gutter + content: the gutter owns the timeline, the content rises in. */
function TimelineRow({
  kind, index, animate, children,
}: { kind: Kind; index: number; animate: boolean; children: React.ReactNode }) {
  const colors = useColors();
  const rise = useRise(index, animate);
  const lineColor = lineFor(kind, colors);
  return (
    <View style={{ flexDirection: 'row', height: ROW_H }}>
      <View style={{ height: ROW_H, width: GUTTER }}>
        <Segment color={lineColor} dashed={kind === 'autoplay'} height={ROW_H} index={index} animate={animate} />
        <Animated.View style={[{ flex: 1 }, rise]}>
          <Node kind={kind} lineColor={lineColor} />
        </Animated.View>
      </View>
      <Animated.View style={[{ flex: 1, justifyContent: 'center' }, rise]}>{children}</Animated.View>
    </View>
  );
}

function SectionLabel({
  children, kind, index, animate, right,
}: { children: React.ReactNode; kind: Kind; index: number; animate: boolean; right?: React.ReactNode }) {
  const colors = useColors();
  const rise = useRise(index, animate);
  return (
    <View style={{ flexDirection: 'row', height: LABEL_H }}>
      <View style={{ height: LABEL_H, width: GUTTER }}>
        <Segment color={lineFor(kind, colors)} dashed={kind === 'autoplay'} height={LABEL_H} index={index} animate={animate} />
      </View>
      <Animated.View style={[{ alignItems: 'center', flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: Space[2] }, rise]}>
        <Text variant="label" color="textSecondary">{children}</Text>
        {right}
      </Animated.View>
    </View>
  );
}

function QueueRow({
  track, kind, number, index, animate, onPress, onDrag, onMore, isPlaying = false,
}: {
  track: Track;
  kind: Kind;
  /** Position in the context queue (1-based); undefined for user-queued rows. */
  number?: number;
  index: number;
  animate: boolean;
  onPress?: () => void;
  onDrag?: () => void;
  onMore?: (track: Track) => void;
  isPlaying?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const isCurrent = kind === 'now';
  const isPlayed = kind === 'played';
  const thumbnail = track.thumbnail_url || track.thumbnailUrl || track.artwork;
  const channel = track.channel_name || track.channelName || track.artist;
  const label = kind === 'user' || number == null ? '+' : String(number).padStart(2, '0');

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onDrag}
      delayLongPress={200}
      style={({ pressed }) => [styles.row, isCurrent && styles.rowCurrent, pressed && !isCurrent && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${channel}${isCurrent ? ', now playing' : isPlayed ? ', played' : ''}`}
    >
      <Text variant="mono" color={isCurrent ? 'accentInk' : kind === 'user' ? 'signal' : 'textTertiary'} style={styles.number}>
        {label}
      </Text>
      <View style={styles.thumb}>
        {thumbnail ? <Image source={{ uri: thumbnail }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}
        {isCurrent ? (
          <View style={styles.thumbOverlay}>
            <EqualizerBars isPlaying={isPlaying} size="sm" color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text
          variant="bodyStrong"
          color={isCurrent ? 'accentInk' : isPlayed ? 'textTertiary' : 'text'}
          numberOfLines={1}
          style={isPlayed ? { textDecorationLine: 'line-through' } : undefined}
        >
          {track.title}
        </Text>
        <View style={styles.subtitleRow}>
          {track.isRecommendation ? <Ionicons name="sparkles" size={12} color={colors.signal} /> : null}
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {(track.isRecommendation || track.isAutoplay) && track.reason
              ? track.reason
              : track.isRecommendation ? `Smart Shuffle · ${channel}` : channel}
          </Text>
        </View>
      </View>
      {!isCurrent && onMore ? (
        <Pressable
          hitSlop={8}
          onPress={() => onMore(track)}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${track.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
        </Pressable>
      ) : null}
      {onDrag ? (
        // The handle drags on touch-down; no long-press needed.
        <Pressable
          onPressIn={() => {
            gestureHaptic();
            onDrag();
          }}
          hitSlop={8}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel={`Reorder ${track.title}`}
        >
          <Ionicons name="reorder-three" size={22} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  const content =
    isCurrent || isPlayed || !track.queueId ? (
      row
    ) : (
      <Swipeable
        rightThreshold={64}
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

  return (
    <TimelineRow kind={kind} index={index} animate={animate}>
      {content}
    </TimelineRow>
  );
}

function formatSubtitle(tracks: Track[]) {
  const n = tracks.length;
  if (n === 0) return undefined;
  const seconds = tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0);
  const songs = `${n} ${n === 1 ? 'song' : 'songs'}`;
  if (seconds <= 0) return songs;
  return `${songs} · about ${Math.max(1, Math.round(seconds / 60))} min`;
}

/** Queue: a timeline. Played, Now, You queued, From <context>, Autoplay. */
export default function QueueSheet({ isVisible, onClose }: QueueSheetProps) {
  const { height } = useWindowDimensions();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const userQueue = usePlayerStore((s) => s.userQueue);
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const context = usePlayerStore((s) => s.context);

  // Rows only play their entrance while the sheet is opening, not when the
  // list recycles them during scrolling.
  const [animate, setAnimate] = useState(isVisible);
  useEffect(() => {
    if (!isVisible) {
      setAnimate(false);
      return;
    }
    setAnimate(true);
    const timer = setTimeout(() => setAnimate(false), 1400);
    return () => clearTimeout(timer);
  }, [isVisible]);

  const played = currentIndex > 0 ? queue.slice(Math.max(0, currentIndex - PLAYED_COUNT), currentIndex) : [];
  const playedStart = currentIndex - played.length;
  const upcoming = queue.slice(currentIndex + 1);
  const contextUpcoming = upcoming.filter((t) => !t.isAutoplay);
  const autoplayUpcoming = upcoming.filter((t) => t.isAutoplay);

  const play = (track: Track) => {
    tapHaptic();
    if (track.queueId) void playback.playQueueItem(track.queueId);
  };

  // Android can't stack two modal sheets, so close the queue first and open
  // the song menu once its exit animation is done.
  const openMore = (track: Track) => {
    onClose();
    setTimeout(() => openSongMenu(playback.trackToSong(track), { queueTrack: track }), 280);
  };

  const numberOf = (track: Track) => {
    const i = queue.findIndex((t) => t.queueId === track.queueId);
    return i >= 0 ? i + 1 : undefined;
  };

  // Running index across sections so the entrance staggers down the whole line.
  let idx = 0;
  const playedBase = idx;
  idx += played.length > 0 ? played.length + 1 : 0;
  const nowBase = idx;
  idx += currentTrack ? 2 : 0;
  const userBase = idx;
  idx += userQueue.length > 0 ? userQueue.length + 1 : 0;
  const contextBase = idx;
  idx += contextUpcoming.length > 0 ? contextUpcoming.length + 1 : 0;
  const autoplayBase = idx;
  const shownAutoplay = autoplayUpcoming.slice(0, 15);

  const header = (
    <View>
      {played.length > 0 ? (
        <>
          <SectionLabel kind="played" index={playedBase} animate={animate}>Played</SectionLabel>
          {played.map((track, i) => (
            <QueueRow
              key={track.queueId ?? `${track.id}-${i}`}
              track={track}
              kind="played"
              number={playedStart + i + 1}
              index={playedBase + 1 + i}
              animate={animate}
              onPress={() => play(track)}
              onMore={openMore}
            />
          ))}
        </>
      ) : null}
      {currentTrack ? (
        <>
          <SectionLabel kind="now" index={nowBase} animate={animate}>Now playing</SectionLabel>
          <QueueRow
            track={currentTrack}
            kind="now"
            number={currentIndex >= 0 ? currentIndex + 1 : undefined}
            index={nowBase + 1}
            animate={animate}
            isPlaying={isPlaying}
          />
        </>
      ) : null}
      {userQueue.length > 0 ? (
        <>
          <SectionLabel
            kind="user"
            index={userBase}
            animate={animate}
            right={<Button label="Clear" size="sm" variant="secondary" onPress={playback.clearUserQueue} />}
          >
            You queued
          </SectionLabel>
          {userQueue.map((track, i) => (
            <QueueRow
              key={track.queueId}
              track={track}
              kind="user"
              index={userBase + 1 + i}
              animate={animate}
              onPress={() => play(track)}
              onMore={openMore}
            />
          ))}
        </>
      ) : null}
      {contextUpcoming.length > 0 ? (
        <SectionLabel kind="context" index={contextBase} animate={animate}>{`From ${context?.name ?? 'your queue'}`}</SectionLabel>
      ) : null}
    </View>
  );

  const footer = (
    <View>
      {shownAutoplay.length > 0 ? (
        <>
          <SectionLabel kind="autoplay" index={autoplayBase} animate={animate}>Autoplay · similar music</SectionLabel>
          {shownAutoplay.map((track, i) => (
            <QueueRow
              key={track.queueId}
              track={track}
              kind="autoplay"
              number={numberOf(track)}
              index={autoplayBase + 1 + i}
              animate={animate}
              onPress={() => play(track)}
              onMore={openMore}
            />
          ))}
        </>
      ) : null}
      {upcoming.length === 0 && userQueue.length === 0 ? (
        <Text variant="caption" color="textSecondary" align="center" style={{ paddingVertical: Space[6] }}>
          Nothing up next. Swipe right on any song, or choose Add to queue from its menu.
        </Text>
      ) : null}
    </View>
  );

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={{ paddingHorizontal: Space[4] }}>
        <SheetHeader title="Up next" subtitle={formatSubtitle([...userQueue, ...upcoming])} />
        <View style={{ height: height * 0.66 }}>
          <DraggableFlatList
            data={contextUpcoming}
            keyExtractor={(item) => item.queueId ?? item.id}
            renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<Track>) => (
              <ScaleDecorator activeScale={1.03}>
                <View style={{ opacity: isActive ? 0.9 : 1 }}>
                  <QueueRow
                    track={item}
                    kind="context"
                    number={numberOf(item)}
                    index={contextBase + 1 + (getIndex() ?? 0)}
                    animate={animate}
                    onPress={() => play(item)}
                    onDrag={drag}
                    onMore={openMore}
                  />
                </View>
              </ScaleDecorator>
            )}
            onDragEnd={({ data }) => playback.reorderUpcoming([...data, ...autoplayUpcoming])}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={{ paddingBottom: Space[8] }}
          />
        </View>
      </View>
    </AnimatedBottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    alignItems: 'center',
    backgroundColor: t.colors.surface,
    borderRadius: Radius.sm,
    flexDirection: 'row',
    gap: Space[2],
    height: ROW_H - 4,
    paddingHorizontal: Space[2],
  },
  rowCurrent: { backgroundColor: t.colors.accentSoft },
  rowPressed: { backgroundColor: t.colors.surfaceRaised },
  number: { textAlign: 'center', width: 22 },
  thumb: { backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.sm, height: 40, overflow: 'hidden', width: 40 },
  thumbOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  meta: { flex: 1, gap: 2, minWidth: 0 },
  subtitleRow: { alignItems: 'center', flexDirection: 'row', gap: Space[1] },
  iconButton: { alignItems: 'center', height: Layout.touchTarget, justifyContent: 'center', width: 32 },
  deleteAction: {
    alignItems: 'flex-end',
    backgroundColor: t.colors.danger,
    borderRadius: Radius.sm,
    flex: 1,
    justifyContent: 'center',
    paddingRight: Space[5],
  },
}));
