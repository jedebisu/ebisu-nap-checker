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
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { authAPI, errorMessage } from '../services/api';
import { authStyles as s, COLORS } from '../theme';

// Mirrors the server's rules exactly (server/src/services/passwords.js), so the
// user sees all four ticks before pressing the button instead of one error at
// a time from the server.
const passwordRules = (password) => [
  { label: 'At least 8 characters', ok: password.length >= 8 },
  { label: 'At least one uppercase letter', ok: /[A-Z]/.test(password) },
  { label: 'At least one number', ok: /[0-9]/.test(password) },
  { label: 'At least one special character', ok: /[^A-Za-z0-9]/.test(password) },
];

export default function ForceResetScreen({ navigation }) {
  const { resetToken, completeLogin, clearMustReset } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const rules = passwordRules(password);
  const allRulesPass = rules.every((rule) => rule.ok);
  const matches = confirm.length > 0 && confirm === password;
  const canSubmit = allRulesPass && matches && !submitting && Boolean(resetToken);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const data = await authAPI.resetPassword(resetToken, password);
      // A real session token comes back now; storing it switches the navigator
      // from the auth screens to the Dashboard.
      await completeLogin(data.token, data.user);
    } catch (resetError) {
      setError(errorMessage(resetError));
      setSubmitting(false);
    }
  };

  const backToLogin = () => {
    clearMustReset();
    navigation.navigate('Login');
  };

  // Reaching this screen without a reset token should be impossible, but a
  // dead end would leave the user stuck, so offer a way out.
  if (!resetToken) {
    return (
      <View style={[s.container, { justifyContent: 'center', paddingHorizontal: 24 }]}>
        <View style={s.card}>
          <Text style={s.label}>Please log in again</Text>
          <Text style={s.hint}>The password reset session is no longer valid.</Text>
          <TouchableOpacity style={s.button} onPress={backToLogin} activeOpacity={0.8}>
            <Text style={s.buttonText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <View style={s.accent} />
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <Text style={s.brandTitle}>Set your password</Text>
          <Text style={s.brandSubtitle}>
            Choose a new password for your account.{'\n'}You will use it from now on.
          </Text>
        </View>

        <View style={s.card}>
          {error ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>{error}</Text>
            </View>
          ) : null}

          <View style={s.field}>
            <Text style={s.label}>New password</Text>
            <View>
              <TextInput
                style={[s.input, { paddingRight: 52 }]}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError('');
                }}
                placeholder="Choose a strong password"
                placeholderTextColor={COLORS.placeholder}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                accessibilityLabel="New password"
              />
              <TouchableOpacity
                style={{ position: 'absolute', right: 14, top: 14, padding: 4 }}
                onPress={() => setShowPassword((shown) => !shown)}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={COLORS.muted}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.rules}>
            {rules.map((rule) => (
              <View key={rule.label} style={styles.rule}>
                <Ionicons
                  name={rule.ok ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={rule.ok ? COLORS.success : COLORS.placeholder}
                />
                <Text style={[styles.ruleText, rule.ok && styles.ruleTextOk]}>{rule.label}</Text>
              </View>
            ))}
          </View>

          <View style={[s.field, { marginTop: 8 }]}>
            <Text style={s.label}>Confirm password</Text>
            <TextInput
              style={[s.input, confirm.length > 0 && !matches ? s.inputInvalid : null]}
              value={confirm}
              onChangeText={(text) => {
                setConfirm(text);
                setError('');
              }}
              placeholder="Type it again"
              placeholderTextColor={COLORS.placeholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              accessibilityLabel="Confirm password"
            />
            {confirm.length > 0 && !matches ? (
              <Text style={s.fieldError}>Passwords do not match.</Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={[s.button, !canSubmit && s.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Save password</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.link} onPress={backToLogin} disabled={submitting}>
            <Text style={s.mutedLinkText}>Cancel and go back to login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = {
  rules: { marginBottom: 12 },
  rule: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  ruleText: { marginLeft: 8, fontSize: 13, color: COLORS.muted },
  ruleTextOk: { color: COLORS.success, fontWeight: '600' },
};
