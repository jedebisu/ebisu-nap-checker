import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { authAPI } from '../services/api';

export default function RegisterScreen({ onOtpSent, onBack }) {
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    const trimmed = {
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      email: email.trim(),
      phone: phone.trim(),
      invite_code: inviteCode.trim(),
    };
    if (!trimmed.firstname || !trimmed.lastname || !trimmed.email || !trimmed.phone || !trimmed.invite_code) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await authAPI.register(trimmed);
      Alert.alert('OTP Sent', `OTP sent to ${trimmed.email}`);
      onOtpSent(trimmed.email);
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Registration failed';
      Alert.alert('Registration Failed', message);
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
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Register with your invitation key</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Firstname</Text>
              <TextInput
                style={styles.input}
                value={firstname}
                onChangeText={setFirstname}
                placeholder="Juan"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
                editable={!loading}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Lastname</Text>
              <TextInput
                style={styles.input}
                value={lastname}
                onChangeText={setLastname}
                placeholder="Dela Cruz"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
                editable={!loading}
              />
            </View>
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
              <Text style={styles.label}>Number</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="09xxxxxxxxx"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Invitation Key</Text>
              <TextInput
                style={styles.input}
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="Enter your invitation key"
                placeholderTextColor="#9ca3af"
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
              />
            </View>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Register</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.backLink}
              onPress={onBack}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.backLinkText}>Already have an account? <Text style={styles.backLinkStrong}>Sign In</Text></Text>
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
    position: 'absolute', top: 0, left: 0, right: 0, height: 260,
    backgroundColor: '#00539B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 48, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  form: {
    backgroundColor: '#fff', padding: 24, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8,
  },
  inputGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14, padding: 14, fontSize: 16,
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  button: {
    backgroundColor: '#00539B', padding: 17, borderRadius: 14, alignItems: 'center', marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  backLink: { marginTop: 16, alignItems: 'center', paddingVertical: 6 },
  backLinkText: { fontSize: 14, color: '#6b7280' },
  backLinkStrong: { color: '#00539B', fontWeight: '700' },
});
