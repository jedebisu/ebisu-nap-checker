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
import { authStyles as s, COLORS } from '../theme';

export default function LoginScreen({ navigation, route }) {
  const { login } = useAuth();
  // Coming from the OTP screen, the email is already known — save the typing.
  const [email, setEmail] = useState(route?.params?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const arrivedFromOtp = Boolean(route?.params?.email);

  const handleLogin = async () => {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setError('');
    setSubmitting(true);
    const result = await login(email.trim().toLowerCase(), password);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    if (result.mustReset) {
      // Temporary password accepted. The app may not be used yet: the forced
      // reset screen opens and hands back a real session when it finishes.
      navigation.navigate('ForceReset');
    }
    // Otherwise AuthContext now has a user, and the navigator switches to the
    // Dashboard on its own.
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      {/* App name banner — G-MAPS with attribution */}
      <View style={s.brand}>
        <Text style={s.brandTitle}>G-MAPS</Text>
        <Text style={s.brandSubtitle}>
          Globe Mapping & Availability Platform System<br />
          { 'by EBISU – Jed Singson'.split(' ').map((w, i) => <Text key={i} style={{ marginLeft: i > 0 ? 8 : 0 }}>{w}</Text>)}
        </Text>
      </View>

      <View style={s.card}>
        {arrivedFromOtp ? (
          <View style={s.infoBanner}>
            <Text style={s.infoBannerText}>
              Your temporary password was emailed to you. It is valid for 24 hours.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={s.banner}>
            <Text style={s.bannerText}>{error}</Text>
          </View>
        ) : null}

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
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Password</Text>
          <View>
            <TextInput
              style={[s.input, { paddingRight: 52 }]}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError('');
              }}
              placeholder="Enter your password"
              placeholderTextColor={COLORS.placeholder}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              accessibilityLabel="Password"
              onSubmitEditing={handleLogin}
            />
            {/* Temporary passwords are random strings, so a visible option
                saves a lot of retyping. */}
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

        <TouchableOpacity
          style={[s.button, submitting && s.buttonDisabled]}
          onPress={handleLogin}
          disabled={submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.link}
          onPress={() => navigation.navigate('ForgotPassword')}
          disabled={submitting}
        >
          <Text style={s.linkText}>Forgot password?</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={s.link}
        onPress={() => navigation.navigate('Register')}
        disabled={submitting}
      >
        <Text style={s.mutedLinkText}>New here? Register with an invite code</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}