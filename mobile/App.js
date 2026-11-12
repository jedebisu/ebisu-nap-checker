import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Placeholder until the auth navigator lands in Task 13. Keeping the project
// bootable after Task 1 means Metro catches wiring errors immediately.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>EBISU NAP Checker</Text>
      <Text style={styles.subtitle}>Loading…</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1d23' },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 8 },
});
