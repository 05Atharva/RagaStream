import React from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import LikeButton from './LikeButton';
import SheetRow from './ui/SheetRow';
import Text from './ui/Text';
import { Radius, Space } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';

export type SongAction = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  destructive?: boolean;
};

type SongOptionsSheetProps = {
  isVisible: boolean;
  onClose: () => void;
  thumbnail?: string | null;
  title: string;
  channel: string;
  isLiked: boolean;
  onToggleLike: () => void;
  actions: SongAction[];
  /** Ref on the header artwork — glide flights launch from here. */
  thumbRef?: React.RefObject<View | null>;
};

export default function SongOptionsSheet({
  isVisible,
  onClose,
  thumbnail,
  title,
  channel,
  isLiked,
  onToggleLike,
  actions,
  thumbRef,
}: SongOptionsSheetProps) {
  const colors = useColors();
  const { height } = useWindowDimensions();

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={{ paddingBottom: Space[3], paddingHorizontal: Space[3] }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], paddingBottom: Space[4], paddingHorizontal: Space[2] }}>
          <View
            ref={thumbRef}
            collapsable={false}
            style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.sm, height: 56, overflow: 'hidden', width: 56 }}
          >
            {thumbnail ? <Image source={{ uri: thumbnail }} style={{ height: '100%', width: '100%' }} contentFit="cover" /> : null}
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="subtitle" numberOfLines={2}>{title}</Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>{channel}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: colors.border, height: 1, marginBottom: Space[2], marginHorizontal: Space[2] }} />

        <ScrollView style={{ maxHeight: height * 0.6 }} bounces={false} showsVerticalScrollIndicator={false}>
          <SheetRow
            label={isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
            onPress={onToggleLike}
            leading={
              <View style={{ alignItems: 'center', marginHorizontal: -6, width: 40 }}>
                <LikeButton isLiked={isLiked} onToggle={onToggleLike} size={22} />
              </View>
            }
          />
          {actions.map((action) => (
            <SheetRow key={action.key} label={action.label} icon={action.icon} onPress={action.onPress} destructive={action.destructive} />
          ))}
        </ScrollView>
      </View>
    </AnimatedBottomSheet>
  );
}
