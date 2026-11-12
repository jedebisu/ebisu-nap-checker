// EBISU NAP Checker — root navigator.
// While auth is loading (reading AsyncStorage on startup) we show a spinner so
// screens don't flicker between login and dashboard. Once loaded, a stored user
// sees the two main tabs; everyone else sees the auth stack.
//
// auth-stack screens (shown when not logged in):
//   Register  — invite-code sign-up
//   OtpVerify — 6-digit emailed code
//   Login     — email + password (or temp password)
//   ForceReset — first-login mandatory password change
//   ForgotPassword — request a fresh temp password
//
// main-tabs screens (shown when logged in):
//   Dashboard — greeting + NAP report date + "Open NAP Map"
//   NapMap    — live map with search, pins, and nearby list
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import RegisterScreen from './src/screens/RegisterScreen';
import OtpVerifyScreen from './src/screens/OtpVerifyScreen';
import LoginScreen from './src/screens/LoginScreen';
import ForceResetScreen from './src/screens/ForceResetScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import NapMapScreen from './src/screens/NapMapScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ─── Main tab navigator ──────────────────────────────────────────────────────

const TAB_LABELS = {
  Dashboard: 'Home',
  NapMap: 'NAPs',
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: '#1a1d23' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        tabBarActiveTintColor: '#c8956c',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarLabel: TAB_LABELS[route.name] || route.name,
        tabBarIcon: ({ color, size }) => {
          const icons = { Dashboard: 'home', NapMap: 'map' };
          return <Ionicons name={icons[route.name] || 'help'} color={color} size={size} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'EBISU NAP Checker' }} />
      <Tab.Screen name="NapMap" component={NapMapScreen} options={{ title: 'NAP Map' }} />
    </Tab.Navigator>
  );
}

// ─── Root navigator: gated by auth state ─────────────────────────────────────

function RootNavigator() {
  const { user, loading, mustReset } = useAuth();

  if (loading) {
    // Shown while AsyncStorage is read on app start. Without this the user
    // would briefly see Login even if they have a valid session.
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff' }}>
        <ActivityIndicator size="large" color="#c8956c" />
      </View>
    );
  }

  // ForceReset must always appear before the main tabs so the owner cannot
  // peek at dashboard data until they've chosen a real password.
  if (mustReset) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ForceReset" component={ForceResetScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          {/* These remain reachable as nested stacks so deeper screens added later
              keep working without restructuring MainTabs. */}
          <Stack.Screen name="NapDetails" component={NapMapScreen} options={{ title: 'NAP Details' }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="OtpVerify" component={OtpVerifyScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
