import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing } from '../constants/theme';

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Library</Text>
        <Text style={styles.subtitle}>Your saved music and playlists</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  title: {
    fontSize: Typography.fontSizeXxl,
    fontWeight: Typography.fontWeightBold,
    color: Colors.onBackground,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.fontSizeMd,
    color: Colors.muted,
    textAlign: 'center',
  },
});
