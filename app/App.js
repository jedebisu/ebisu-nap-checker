import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import OtpScreen from './src/screens/OtpScreen';
import PasswordSetupScreen from './src/screens/PasswordSetupScreen';
import NapMapScreen from './src/screens/NapMapScreen';
import DashboardScreen from './src/screens/DashboardScreen';

function Root() {
  const { user, loading, logout } = useAuth();
  const [screen, setScreen] = useState('login'); // 'login' | 'register' | 'otp'
  const [otpEmail, setOtpEmail] = useState('');
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'map'

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00539B" />
      </View>
    );
  }

  const handleLogout = () => {
    setView('dashboard');
    logout();
  };

  if (user) {
    if (user.must_change_password) return <PasswordSetupScreen />;
    return view === 'map'
      ? <NapMapScreen />
      : <DashboardScreen onOpenMap={() => setView('map')} onLogout={handleLogout} />;
  }

  if (screen === 'register') {
    return (
      <RegisterScreen
        onOtpSent={(email) => {
          setOtpEmail(email);
          setScreen('otp');
        }}
        onBack={() => setScreen('login')}
      />
    );
  }

  if (screen === 'otp') {
    return (
      <OtpScreen
        email={otpEmail}
        onVerified={() => setScreen('login')}
        onBack={() => setScreen('login')}
      />
    );
  }

  return <LoginScreen onCreateAccount={() => setScreen('register')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
