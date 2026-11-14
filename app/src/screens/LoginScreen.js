import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';

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
      <LinearGradient
        colors={['#00539B', '#FF3C86', '#FF8C00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bgAccent}
      />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <View style={styles.logoWrap}>
              <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
            </View>
            <Text style={styles.title}>G-MAPS</Text>
            <Text style={styles.subtitle}>NAP Facility Map</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
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
                placeholderTextColor="#9ca3af"
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
  bgAccent: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 320,
    backgroundColor: '#00539B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, marginTop: 40, paddingBottom: 32 },
  logoContainer: { alignItems: 'center', marginBottom: 48 },
  logoWrap: {
    width: 100, height: 100, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
  },
  logo: { width: 72, height: 72, borderRadius: 16, overflow: 'hidden' },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: 3 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 6, letterSpacing: 1 },
  form: {
    backgroundColor: '#fff', padding: 28, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8,
  },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14, padding: 16, fontSize: 16,
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  button: {
    backgroundColor: '#00539B', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 1 },
  createAccount: { marginTop: 18, alignItems: 'center', paddingVertical: 6 },
  createAccountText: { fontSize: 14, color: '#6b7280' },
  createAccountLink: { color: '#00539B', fontWeight: '700' },
  footer: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 32, letterSpacing: 0.5 },
  byline: { textAlign: 'center', color: '#6b7280', fontSize: 11, marginTop: 6, fontWeight: '500' },
});
