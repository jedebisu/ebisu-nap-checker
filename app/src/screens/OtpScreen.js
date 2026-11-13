import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { authAPI } from '../services/api';

const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpScreen({ email, onVerified, onBack }) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const timerRef = useRef(null);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // The OTP was just emailed at registration time, so start with a cooldown.
  useEffect(() => {
    startCooldown();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleVerify = async () => {
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      Alert.alert('Error', 'Please enter the 6-digit code');
      return;
    }
    setLoading(true);
    try {
      await authAPI.verifyOtp({ email, otp: code });
      Alert.alert('Verified', 'Temporary password sent to your email');
      onVerified();
    } catch (error) {
      const data = error.response?.data;
      if (data?.lockout_minutes) {
        Alert.alert(
          'Too Many Attempts',
          `Too many wrong attempts. Try again in ${data.lockout_minutes} minutes, or ask the administrator to reset your account.`
        );
      } else {
        Alert.alert('Verification Failed', data?.error || error.message || 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resendLoading) return;
    setResendLoading(true);
    try {
      await authAPI.resendOtp({ email });
      Alert.alert('OTP Sent', `New OTP sent to ${email}`);
      startCooldown();
    } catch (error) {
      const message = error.response?.data?.error || error.message || 'Failed to resend OTP';
      Alert.alert('Resend Failed', message);
    } finally {
      setResendLoading(false);
    }
  };

  const resendDisabled = cooldown > 0 || resendLoading;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.bgAccent} />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Enter OTP</Text>
            <Text style={styles.subtitle}>We sent a 6-digit code to{'\n'}{email}</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>One-Time Password</Text>
              <TextInput
                style={styles.otpInput}
                value={otp}
                onChangeText={(text) => setOtp(text.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="••••••"
                placeholderTextColor="#9ca3af"
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
                editable={!loading}
              />
            </View>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.resendButton, resendDisabled && styles.resendButtonDisabled]}
              onPress={handleResend}
              disabled={resendDisabled}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              {resendLoading ? (
                <ActivityIndicator color="#00539B" />
              ) : (
                <Text style={[styles.resendText, resendDisabled && styles.resendTextDisabled]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.backLink}
              onPress={onBack}
              disabled={loading}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.backLinkText}>Back to <Text style={styles.backLinkStrong}>Sign In</Text></Text>
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
    position: 'absolute', top: 0, left: 0, right: 0, height: 300,
    backgroundColor: '#00539B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 48, paddingBottom: 32 },
  header: { alignItems: 'center', marginBottom: 36 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 8, textAlign: 'center', lineHeight: 19 },
  form: {
    backgroundColor: '#fff', padding: 24, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8,
  },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 10, letterSpacing: 0.5, textAlign: 'center' },
  otpInput: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12,
    fontSize: 28, letterSpacing: 12, fontWeight: '700',
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  button: {
    backgroundColor: '#00539B', padding: 17, borderRadius: 14, alignItems: 'center', marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 1 },
  resendButton: { marginTop: 14, paddingVertical: 12, alignItems: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: '#00539B' },
  resendButtonDisabled: { borderColor: '#d1d5db', backgroundColor: '#f3f4f6' },
  resendText: { color: '#00539B', fontSize: 15, fontWeight: '700' },
  resendTextDisabled: { color: '#9ca3af' },
  backLink: { marginTop: 12, alignItems: 'center', paddingVertical: 6 },
  backLinkText: { fontSize: 14, color: '#6b7280' },
  backLinkStrong: { color: '#00539B', fontWeight: '700' },
});
