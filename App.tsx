import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BottomTabNavigator from './navigation/BottomTabNavigator';
import { Colors } from './constants/theme';

// Extend React Navigation's DarkTheme with our custom palette
const RagaStreamTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.primary,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.onBackground,
    border: Colors.border,
    notification: Colors.primary,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={RagaStreamTheme}>
        <StatusBar style="light" backgroundColor={Colors.background} />
        <BottomTabNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
