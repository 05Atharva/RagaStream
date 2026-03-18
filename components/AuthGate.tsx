import React, { useState } from 'react';
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';

export default function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  if (mode === 'signup') {
    return <SignupScreen onSwitchToLogin={() => setMode('login')} />;
  }

  return <LoginScreen onSwitchToSignup={() => setMode('signup')} />;
}
