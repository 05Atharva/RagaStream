import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, Layout, Space } from '../constants/theme';
import { useColors, useTheme } from '../theme/ThemeProvider';
import { MeendMark } from './Logo';
import Rise from '../motion/Rise';
import Text from './ui/Text';

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
};

/**
 * Shared frame for sign-in and sign-up: a giant, faint Meend stroke draws
 * itself behind the content (the brand as landscape), the mark draws in the
 * corner, then the words and form rise in order.
 */
export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const colors = useColors();
  const { isDark } = useTheme();

  return (
    <SafeAreaView style={{ backgroundColor: colors.bg, flex: 1 }}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -120, top: -40, opacity: isDark ? 0.07 : 0.09 }}>
        <MeendMark size={460} animate delay={250} stroke={Brand.kesar} dot={Brand.neel} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, gap: Space[8], paddingBottom: Space[8], paddingHorizontal: Layout.gutter + 4, paddingTop: Space[6] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MeendMark size={52} animate />
          <Rise index={2} style={{ gap: Space[2] }}>
            <Text variant="hero">{title}</Text>
            <Text variant="body" color="textSecondary">{subtitle}</Text>
          </Rise>
          <Rise index={4} style={{ gap: Space[4] }}>{children}</Rise>
          <View style={{ flex: 1 }} />
          <Rise index={6} style={{ alignItems: 'center' }}>{footer}</Rise>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
