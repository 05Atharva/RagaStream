import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { Layout, Space } from '../../constants/theme';
import Rise from '../../motion/Rise';
import { successHaptic } from '../../services/haptics';
import { itemsNotFound, searchQueryFor, type ImportItem, type ImportJob } from '../../services/importLogic';
import { MeendMark } from '../Logo';
import Button from '../ui/Button';
import Text from '../ui/Text';

type DoneStepProps = {
  job: ImportJob;
  onOpen: () => void;
  onSearch: (query: string) => void;
};

/**
 * Step 4. A small earned moment: the mark draws once and the words rise. Not
 * the full milestone; that stays reserved for Riyaz milestones.
 */
export default function DoneStep({ job, onOpen, onSearch }: DoneStepProps) {
  const missing = itemsNotFound(job);
  const [buzzed, setBuzzed] = useState(false);

  const header = (
    <View style={{ gap: Space[5], paddingBottom: Space[4] }}>
      <MeendMark
        size={72}
        animate
        onDrawn={() => {
          if (!buzzed) {
            setBuzzed(true);
            successHaptic();
          }
        }}
      />
      <Rise delay={500} index={0} style={{ gap: Space[2] }}>
        <Text variant="display" accessibilityRole="header">{`${job.name} is ready`}</Text>
        <Text variant="mono" color="textSecondary">{`${job.matched} of ${job.total} songs found`}</Text>
      </Rise>
      <Rise delay={500} index={1}>
        <Button label="Open playlist" size="lg" fullWidth onPress={onOpen} />
      </Rise>
      {missing.length > 0 ? (
        <Rise delay={500} index={2} style={{ gap: Space[1], paddingTop: Space[3] }}>
          <Text variant="title" accessibilityRole="header">{`${missing.length} not found`}</Text>
          <Text variant="caption" color="textSecondary">Search for them by hand and add the right version.</Text>
        </Rise>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: ImportItem }) => (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{item.title}</Text>
        {item.artists.length ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{item.artists.join(', ')}</Text> : null}
      </View>
      <Button label="Search" variant="outline" onPress={() => onSearch(searchQueryFor(item))} accessibilityLabel={`Search for ${item.title}`} />
    </View>
  );

  return (
    <FlatList
      data={missing}
      keyExtractor={(i) => String(i.index)}
      renderItem={renderItem}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: Space[8], paddingHorizontal: Layout.gutter, paddingTop: Space[4] }}
      showsVerticalScrollIndicator={false}
    />
  );
}
