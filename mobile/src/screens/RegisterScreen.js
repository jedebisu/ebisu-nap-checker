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
import { authStyles as s } from '../theme';

// Same rule as the server. Checking here too means an obvious typo is caught
// before the user waits for a round trip.
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  invite_code: '',
};

export default function RegisterScreen({ navigation }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    setServerError('');
  };

  const validate = () => {
    const next = {};
    if (!form.first_name.trim()) next.first_name = 'Enter your first name.';
    if (!form.last_name.trim()) next.last_name = 'Enter your last name.';
    if (!form.email.trim()) {
      next.email = 'Enter your email address.';
    } else if (!EMAIL_RE.test(form.email.trim())) {
      next.email = 'That does not look like an email address.';
    }
    const digits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim()) next.phone = 'Enter your phone number.';
    else if (digits.length < 7) next.phone = 'Enter a complete phone number.';
    if (!form.invite_code.trim()) next.invite_code = 'Enter the invite code from your admin.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleRegister = async () => {
    if (submitting) return;
    setServerError('');
    if (!validate()) return;

    setSubmitting(true);
    // The server stores the email lowercased; sending it that way keeps the OTP
    // screen and login screen looking up exactly the same account.
    const email = form.email.trim().toLowerCase();
    try {
      await authAPI.register({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email,
        phone: form.phone.trim(),
        invite_code: form.invite_code.trim().toUpperCase(),
      });
      navigation.navigate('OtpVerify', { email });
    } catch (error) {
      setServerError(errorMessage(error));
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
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <Text style={s.brandTitle}>Create your account</Text>
          <Text style={s.brandSubtitle}>
            Registration is invite-only.{'\n'}Ask your admin for an invite code.
          </Text>
        </View>

        <View style={s.card}>
          {serverError ? (
            <View style={s.banner}>
              <Text style={s.bannerText}>{serverError}</Text>
            </View>
          ) : null}

          <Field
            label="First name"
            value={form.first_name}
            onChangeText={update('first_name')}
            placeholder="e.g. Juan"
            error={fieldErrors.first_name}
            editable={!submitting}
            autoCapitalize="words"
          />
          <Field
            label="Last name"
            value={form.last_name}
            onChangeText={update('last_name')}
            placeholder="e.g. Dela Cruz"
            error={fieldErrors.last_name}
            editable={!submitting}
            autoCapitalize="words"
          />
          <Field
            label="Email address"
            value={form.email}
            onChangeText={update('email')}
            placeholder="you@company.com"
            error={fieldErrors.email}
            editable={!submitting}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Phone number"
            value={form.phone}
            onChangeText={update('phone')}
            placeholder="+63 917 123 4567"
            error={fieldErrors.phone}
            editable={!submitting}
            keyboardType="phone-pad"
          />
          <Field
            label="Invite code"
            value={form.invite_code}
            onChangeText={(text) => update('invite_code')(text.toUpperCase())}
            placeholder="8 characters"
            error={fieldErrors.invite_code}
            editable={!submitting}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
          />

          <TouchableOpacity
            style={[s.button, submitting && s.buttonDisabled]}
            onPress={handleRegister}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Register</Text>
            )}
          </TouchableOpacity>

          <Text style={[s.hint, { marginTop: 14, textAlign: 'center' }]}>
            We will email you a 6-digit code to confirm your address.
          </Text>
        </View>

        <TouchableOpacity
          style={[s.link, { marginBottom: 20 }]}
          onPress={() => navigation.navigate('Login')}
          disabled={submitting}
        >
          <Text style={s.linkText}>Already registered? Log in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// One labelled input, so the five fields above stay readable. Errors appear
// directly under the field they belong to.
function Field({ label, error, ...inputProps }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, error ? s.inputInvalid : null]}
        placeholderTextColor="#9ca3af"
        accessibilityLabel={label}
        {...inputProps}
      />
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}
