// Single source of truth for "who is logged in". The navigator reads this and
// shows either the auth screens or the main screens; no screen has to decide
// that on its own.
//
// Two different tokens exist and must not be confused:
//   token      — a normal session; sent as "Authorization: Bearer ..."
//   resetToken — only good for POST /auth/reset-password, until the first-login
//                password change is finished
import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI, setUnauthorizedHandler, errorMessage } from '../services/api';

const STORAGE_KEYS = ['auth_token', 'auth_user'];

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mustReset, setMustReset] = useState(false);
  const [resetToken, setResetToken] = useState(null);

  // Called by the API client whenever the server rejects our session. Clearing
  // the React state is enough: the navigator falls back to the Login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const [storedToken, storedUser] = await Promise.all([
        AsyncStorage.getItem('auth_token'),
        AsyncStorage.getItem('auth_user'),
      ]);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error('Error loading stored login:', error);
    } finally {
      setLoading(false);
    }
  };

  const persistSession = useCallback(async (newToken, userData) => {
    await AsyncStorage.setItem('auth_token', newToken);
    await AsyncStorage.setItem('auth_user', JSON.stringify(userData));
    setToken(newToken);
    setUser(userData);
    setMustReset(false);
    setResetToken(null);
  }, []);

  // Returns { success, mustReset, error } instead of throwing, so screens can
  // show the message inline without a try/catch around every button press.
  const login = async (email, password) => {
    try {
      const data = await authAPI.login(email, password);
      if (data.must_reset) {
        // Temporary password accepted, but this account may not be used until
        // the owner chooses a real password. No session token exists yet.
        setResetToken(data.reset_token);
        setMustReset(true);
        return { success: true, mustReset: true };
      }
      await persistSession(data.token, data.user);
      return { success: true, mustReset: false };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  };

  // Used by the forced-reset screen once a new password has been accepted.
  const completeLogin = async (newToken, userData) => {
    await persistSession(newToken, userData);
  };

  const logout = async () => {
    try {
      if (token) {
        // Best effort: the server bumps token_version so this token dies even
        // if we never hear back.
        await authAPI.logout();
      }
    } catch {
      // Offline or already revoked — clearing locally is what matters.
    } finally {
      await AsyncStorage.multiRemove(STORAGE_KEYS).catch(() => {});
      setToken(null);
      setUser(null);
      setMustReset(false);
      setResetToken(null);
    }
  };

  const clearMustReset = () => {
    setMustReset(false);
    setResetToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        mustReset,
        resetToken,
        login,
        completeLogin,
        logout,
        setMustReset,
        clearMustReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
