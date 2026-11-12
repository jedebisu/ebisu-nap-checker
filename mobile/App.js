import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';

// Placeholder until the real navigator lands in Task 13. It already reads the
// auth context, so a broken provider shows up here immediately instead of
// hiding until later.
function Placeholder() {
  const { loading } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EBISU NAP Checker</Text>
      {loading ? (
        <ActivityIndicator style={styles.spinner} color="#c8956c" />
      ) : (
        <Text style={styles.subtitle}>Ready</Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Placeholder />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1d23' },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 8 },
  spinner: { marginTop: 12 },
});
