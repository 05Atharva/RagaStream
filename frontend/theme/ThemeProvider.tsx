import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { darkColors, lightColors, type ThemeColors } from '../constants/theme';
import { useSettingsStore } from '../store/settingsStore';

export type ThemeScheme = 'light' | 'dark';

export type Theme = {
  scheme: ThemeScheme;
  isDark: boolean;
  colors: ThemeColors;
};

const darkTheme: Theme = { scheme: 'dark', isDark: true, colors: darkColors };
const lightTheme: Theme = { scheme: 'light', isDark: false, colors: lightColors };

const ThemeContext = createContext<Theme>(darkTheme);

/** Resolves System / Light / Dark from settings and the phone's appearance. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const preference = useSettingsStore((s) => s.themePreference);
  const scheme: ThemeScheme =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;
  return <ThemeContext.Provider value={scheme === 'dark' ? darkTheme : lightTheme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

/**
 * Theme-aware StyleSheet factory. Define once at module level:
 *   const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.bg } }));
 * then call `const styles = useStyles();` inside the component.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T) {
  const cache = new Map<ThemeScheme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => {
      const hit = cache.get(theme.scheme);
      if (hit) return hit;
      const created = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, created);
      return created;
    }, [theme]);
  };
}
