import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { authAPI, errorMessage } from '../services/api';
import { authStyles as s, COLORS } from '../theme';

// The server enforces a 60-second gap between codes, so the button starts
// disabled: asking again too early would only produce an error.
const RESEND_SECONDS = 60;

export default function OtpVerifyScreen({ navigation, route }) {
  const email = route?.params?.email || '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const handleCodeChange = (text) => {
    // Keep digits only: pasted codes sometimes carry spaces or dashes.
    setCode(text.replace(/\D/g, '').slice(0, 6));
    setError('');
    setInfo('');
  };

  const handleVerify = async () => {
    if (submitting) return;
    if (code.length !== 6) {
      setError('Enter all 6 digits of the code.');
      return;
    }
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      await authAPI.verifyOtp(email, code);
      Alert.alert(
        'Email verified',
        'Your temporary password has been emailed. It is valid for 24 hours.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login', { email }) }]
      );
    } catch (verifyError) {
      setError(errorMessage(verifyError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resending || secondsLeft > 0) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      await authAPI.resendOtp(email);
      setInfo('A new code is on its way. Check your inbox.');
      setSecondsLeft(RESEND_SECONDS);
    } catch (resendError) {
      setError(errorMessage(resendError));
      // The server's cooldown is the truth; restart our countdown to match it
      // instead of letting the user hammer a button that cannot work yet.
      if (resendError?.response?.data?.error === 'OTP_RESEND_COOLDOWN') {
        setSecondsLeft(RESEND_SECONDS);
      }
    } finally {
      setResending(false);
    }
  };

  const canVerify = code.length === 6 && !submitting;

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={s.accent} />
      <ScrollView contentContainerStyle={s.centredContent} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <Text style={s.brandTitle}>Check your email</Text>
          <Text style={s.brandSubtitle}>
            We sent a 6-digit code to{'\n'}
            <Text style={{ fontWeight: '700', color: '#fff' }}>{email || 'your email address'}</Text>
          </Text>
        </View>

        <View style={s.card}>
          {error ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>{error}</Text>
            </View>
          ) : null}
          {info ? (
            <View style={s.infoBanner}>
              <Text style={s.infoBannerText}>{info}</Text>
            </View>
          ) : null}

          <Text style={s.label}>Verification code</Text>
          <TextInput
            style={[s.input, styles.codeInput]}
            value={code}
            onChangeText={handleCodeChange}
            placeholder="000000"
            placeholderTextColor="#c7cbd1"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            editable={!submitting}
            accessibilityLabel="6-digit verification code"
          />
          <Text style={s.hint}>The code expires 5 minutes after it was sent.</Text>

          <TouchableOpacity
            style={[s.button, !canVerify && s.buttonDisabled, { marginTop: 20 }]}
            onPress={handleVerify}
            disabled={!canVerify}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Verify code</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.link}
            onPress={handleResend}
            disabled={resending || secondsLeft > 0}
          >
            <Text style={[s.linkText, (resending || secondsLeft > 0) && { color: COLORS.placeholder }]}>
              {secondsLeft > 0
                ? `Resend code in ${secondsLeft}s`
                : resending
                  ? 'Sending…'
                  : 'Resend code'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.link} onPress={() => navigation.navigate('Register')}>
          <Text style={s.mutedLinkText}>Wrong email? Start over</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = {
  codeInput: {
    textAlign: 'center',
    fontSize: 26,
    letterSpacing: 10,
    fontWeight: '700',
    paddingVertical: 16,
  },
};
