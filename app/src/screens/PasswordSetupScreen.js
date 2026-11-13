import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, BackHandler } from 'react-native';
import { authAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const RULES = [
  { key: 'length', label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { key: 'uppercase', label: 'At least one uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { key: 'special', label: 'At least one special character', test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export default function PasswordSetupScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { updateUser } = useAuth();

  // Block Android hardware back while a password change is required.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  const ruleResults = RULES.map((rule) => ({ ...rule, passed: rule.test(password) }));
  const allRulesPass = ruleResults.every((r) => r.passed);
  const passwordsMatch = password.length > 0 && password === confirm;

  const handleSubmit = async () => {
    if (!allRulesPass) {
      Alert.alert('Error', 'Please meet all password requirements');
      return;
    }
    if (!passwordsMatch) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authAPI.setupPassword({ password });
      await updateUser({ must_change_password: false });
      // App.js re-renders to NapMapScreen once the stored user updates.
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Password setup failed';
      Alert.alert('Setup Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.bgAccent} />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Set Your Password</Text>
            <Text style={styles.subtitle}>You're using a temporary password.{'\n'}Choose a new one to continue.</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter new password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>
            <View style={styles.checklist}>
              {ruleResults.map((rule) => (
                <View key={rule.key} style={styles.checklistRow}>
                  <View style={[styles.checkDot, rule.passed && styles.checkDotPassed]}>
                    <Text style={styles.checkMark}>{rule.passed ? '✓' : ''}</Text>
                  </View>
                  <Text style={[styles.checkLabel, rule.passed && styles.checkLabelPassed]}>{rule.label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Re-enter new password"
                placeholderTextColor="#9ca3af"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
              {confirm.length > 0 && !passwordsMatch && (
                <Text style={styles.mismatch}>Passwords do not match</Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.button, (loading || !allRulesPass || !passwordsMatch) && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading || !allRulesPass || !passwordsMatch}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Save Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E5F0FA' },
  bgAccent: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 280,
    backgroundColor: '#00539B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 48, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1, textAlign: 'center' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 8, textAlign: 'center', lineHeight: 19 },
  form: {
    backgroundColor: '#fff', padding: 24, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8,
  },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14, padding: 14, fontSize: 16,
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  checklist: { marginTop: -6, marginBottom: 16, paddingHorizontal: 4 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  checkDot: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#d1d5db',
    justifyContent: 'center', alignItems: 'center', marginRight: 10, backgroundColor: '#f9fafb',
  },
  checkDotPassed: { backgroundColor: '#00539B', borderColor: '#00539B' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  checkLabel: { fontSize: 13, color: '#6b7280' },
  checkLabelPassed: { color: '#003A6B', fontWeight: '600' },
  mismatch: { color: '#dc2626', fontSize: 12, marginTop: 6 },
  button: {
    backgroundColor: '#00539B', padding: 17, borderRadius: 14, alignItems: 'center', marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
});
