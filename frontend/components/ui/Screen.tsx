import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useColors } from '../../theme/ThemeProvider';

type ScreenProps = {
  children: React.ReactNode;
  /** Safe-area edges to pad. Screens under a custom header pass []. */
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
};

/** Root of every screen: theme background + safe area. */
export default function Screen({ children, edges = ['top'], style }: ScreenProps) {
  const colors = useColors();
  if (edges.length === 0) {
    return <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{children}</View>;
  }
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}
