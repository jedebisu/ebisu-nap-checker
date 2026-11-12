import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { authAPI, errorMessage } from '../services/api';
import { authStyles as s, COLORS } from '../theme';

// One message for every outcome. Saying "no such account" would let anyone test
// which emails are registered, so the wording never changes.
const GENERIC_MESSAGE = 'If the account exists, a new password was sent.';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!email.trim()) {
      setError('Enter the email address you registered with.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await authAPI.forgot(email.trim().toLowerCase());
      setSent(true);
    } catch (forgotError) {
      // Only a real network/server failure reaches here; the server answers the
      // same way for known and unknown accounts.
      setError(errorMessage(forgotError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={s.accent} />
      <ScrollView contentContainerStyle={s.centredContent} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <Text style={s.brandTitle}>Forgot password</Text>
          <Text style={s.brandSubtitle}>
            We will email you a new temporary password.{'\n'}It is valid for 24 hours.
          </Text>
        </View>

        <View style={s.card}>
          {error ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>{error}</Text>
            </View>
          ) : null}

          {sent ? (
            <View style={s.infoBanner}>
              <Text style={s.infoBannerText}>{GENERIC_MESSAGE}</Text>
              <Text style={[s.infoBannerText, { marginTop: 8 }]}>
                Log in with it, and the app will ask you to set your own password.
              </Text>
            </View>
          ) : (
            <>
              <View style={s.field}>
                <Text style={s.label}>Email address</Text>
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError('');
                  }}
                  placeholder="you@company.com"
                  placeholderTextColor={COLORS.placeholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                  accessibilityLabel="Email address"
                  onSubmitEditing={handleSubmit}
                />
              </View>

              <TouchableOpacity
                style={[s.button, submitting && s.buttonDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.8}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.buttonText}>Send new password</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={s.link}
            onPress={() => navigation.navigate('Login', { email: email.trim().toLowerCase() })}
            disabled={submitting}
          >
            <Text style={s.linkText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
