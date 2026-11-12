// All HTTP calls to the EBISU NAP Checker server live here. Screens never call
// fetch/axios directly, so the base URL, auth header and error handling are
// defined exactly once.
//
// Where the server lives:
//   - In development the app talks to the server on this laptop (port 3002).
//   - A phone running Expo Go cannot reach "localhost" (localhost on a phone
//     means the phone). Point it at the laptop's Wi-Fi address instead:
//         EXPO_PUBLIC_API_URL=http://192.168.1.20:3002/api npx expo start
//   - Release APKs use PRODUCTION_API_URL. Change it here (and nowhere else)
//     once the server has its permanent Render address.
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PRODUCTION_API_URL = 'https://ebisu-nap-checker-api.onrender.com/api';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (__DEV__ ? 'http://localhost:3002/api' : PRODUCTION_API_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// AuthContext registers a callback here. When the server says our session is
// gone (password changed elsewhere, logged out, token expired), the context
// clears React state and the navigator sends the user back to Login. Without
// this the app would keep retrying with a dead token forever.
let onUnauthorized = null;

export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

// 401s that mean "you typed the wrong password / the reset link is stale",
// not "your session died". Those must not trigger a forced logout.
const NON_SESSION_ERRORS = new Set(['INVALID_CREDENTIALS', 'RESET_TOKEN_INVALID']);

api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.error;
    if (status === 401 && !NON_SESSION_ERRORS.has(code)) {
      await AsyncStorage.multiRemove(['auth_token', 'auth_user']).catch(() => {});
      if (onUnauthorized) onUnauthorized();
    }
    return Promise.reject(error);
  }
);

// The server reports a weak password as { error: 'WEAK_PASSWORD', reason: code }.
// These turn the short codes into sentences.
const PASSWORD_REASONS = {
  length: 'Use at least 8 characters.',
  uppercase: 'Add at least one uppercase letter (A–Z).',
  number: 'Add at least one number.',
  special: 'Add at least one special character, such as ! or @.',
};

// Turns any failure into one plain-English sentence the screens can show as-is.
// The server's own message is used when it is already readable.
export const errorMessage = (error) => {
  const data = error?.response?.data;
  const code = data?.error;

  const messages = {
    EMAIL_IN_USE: 'That email already has an account. Try logging in instead.',
    OTP_INVALID: 'That code is not correct. Check the email and try again.',
    OTP_EXPIRED: 'That code has expired. Tap "Resend code" for a new one.',
    OTP_LOCKED: 'Too many wrong attempts. Request a new code to continue.',
    OTP_RESEND_COOLDOWN: 'Please wait a minute before requesting another code.',
    INVALID_CREDENTIALS: 'Wrong email or password.',
    ACCOUNT_EXPIRED: 'This registration expired. Please register again.',
    OTP_NOT_VERIFIED: 'Verify your email first — the code is in your inbox.',
    WEAK_PASSWORD: PASSWORD_REASONS[data?.reason] || 'Choose a stronger password.',
    AUTH_REQUIRED: 'Your session ended. Please log in again.',
    RESET_TOKEN_INVALID: 'This reset link expired. Log in again to get a new password.',
    NAP_SERVICE_UNAVAILABLE: 'The NAP service is not responding. Try again in a moment.',
  };

  if (code && messages[code]) return messages[code];
  if (code && data?.message) return data.message;
  if (code) return code;
  if (error?.code === 'ECONNABORTED') return 'The server took too long to answer. Try again.';
  if (error?.message === 'Network Error') return 'Cannot reach the server. Check your internet connection.';
  return error?.message || 'Something went wrong. Please try again.';
};

export const authAPI = {
  // Registration is invite-only; the invite code is checked by the server.
  register: async (payload) => {
    const response = await api.post('/auth/register', payload);
    return response.data;
  },

  // Exchanges the 6-digit emailed code for a temporary password (emailed too).
  verifyOtp: async (email, code) => {
    const response = await api.post('/auth/verify-otp', { email, code });
    return response.data;
  },

  resendOtp: async (email) => {
    const response = await api.post('/auth/resend-otp', { email });
    return response.data;
  },

  // Returns either { must_reset: true, reset_token } or
  // { token, must_reset: false, user }.
  login: async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  resetPassword: async (resetToken, newPassword) => {
    const response = await api.post('/auth/reset-password', {
      reset_token: resetToken,
      new_password: newPassword,
    });
    return response.data;
  },

  // Always answers with the same message, whether or not the email exists.
  forgot: async (email) => {
    const response = await api.post('/auth/forgot', { email });
    return response.data;
  },

  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },
};

// NAP data is read-only and proxied by our server; this app never writes NAPs.
export const napsAPI = {
  getNearest: async (params = {}) => {
    const response = await api.get('/naps/nearest', { params });
    return response.data;
  },

  search: async (params = {}) => {
    const response = await api.get('/naps/search', { params });
    return response.data;
  },

  getById: async (napId) => {
    const response = await api.get(`/naps/${napId}`);
    return response.data;
  },

  getStats: async () => {
    const response = await api.get('/naps/stats/summary');
    return response.data;
  },
};

export const SERVER_URL = API_BASE_URL.replace(/\/api$/, '');

export default api;
