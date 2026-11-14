import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ onCreateAccount }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter both Email and Password');
      return;
    }
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (!result.success) Alert.alert('Login Failed', result.error);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.headerBand}>
        <View style={styles.logoContainer}>
          <View style={styles.logoWrap}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.title}>G-MAPS</Text>
          <Text style={styles.subtitle}>NAP Facility Map</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#6b7280"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!loading}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#6b7280"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.createAccount}
              onPress={onCreateAccount}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.createAccountText}>
                Don't have an account? <Text style={styles.createAccountLink}>Create Account</Text>
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.footer}>Secure NAP facility monitoring</Text>
          <Text style={styles.byline}>By: EBISU - Jed Singson</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E5F0FA' },
  headerBand: {
    backgroundColor: '#003A6B',
    paddingTop: Platform.OS === 'android' ? 24 : 0,
    paddingHorizontal: 28,
    paddingBottom: 32,
    alignItems: 'center',
  },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, marginTop: 0, paddingBottom: 32 },
  logoContainer: { alignItems: 'center', marginBottom: 16 },
  logoWrap: {
    width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  logo: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 6, letterSpacing: 0.5 },
  form: {
    backgroundColor: '#fff', padding: 24, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 6,
    marginTop: -20,
  },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 6, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12, padding: 16, fontSize: 16,
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  button: {
    backgroundColor: '#00539B', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 10,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  createAccount: { marginTop: 16, alignItems: 'center', paddingVertical: 12 },
  createAccountText: { fontSize: 13, color: '#4b5563' },
  createAccountLink: { color: '#00539B', fontWeight: '700' },
  footer: { textAlign: 'center', color: '#4b5563', fontSize: 11, marginTop: 28, letterSpacing: 0.5 },
  byline: { textAlign: 'center', color: '#4b5563', fontSize: 10, marginTop: 4, fontWeight: '600' },
});
