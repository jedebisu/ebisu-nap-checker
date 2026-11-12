import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { napsAPI, errorMessage } from '../services/api';
import { formatDate } from '../utils/helpers';
import { COLORS } from '../theme';

export default function DashboardScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError('');
    try {
      setStats(await napsAPI.getStats());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh whenever the dashboard comes back into focus, so the date is never
  // stale after a NAP report import.
  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const confirmLogout = () => {
    Alert.alert('Log out?', 'You will need your email and password to log in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const firstName = user?.first_name || 'there';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {firstName}!</Text>
          <Text style={styles.headerSubtitle}>G-MAPS</Text>
        </View>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={confirmLogout}
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadStats(true)}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.cardLabel}>NAP database last updated</Text>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 18 }} color={COLORS.primary} />
          ) : error ? (
            <View>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => loadStats()}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.date}>{formatDate(stats?.nap_report_date)}</Text>
              <Text style={styles.cardHint}>
                {stats?.total_naps
                  ? `${Number(stats.total_naps).toLocaleString()} NAP records`
                  : 'Report date from the NAP database'}
              </Text>
            </>
          )}
        </View>

        <TouchableOpacity
          style={styles.mapButton}
          onPress={() => navigation.navigate('NapMap')}
          activeOpacity={0.85}
        >
          <View style={styles.mapButtonIcon}>
            <Ionicons name="map" size={26} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mapButtonTitle}>Open NAP Map</Text>
            <Text style={styles.mapButtonSubtitle}>
              Find facilities near you, search, and get directions
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={COLORS.placeholder} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.textButton} onPress={confirmLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.muted} />
          <Text style={styles.textButtonLabel}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = {
  header: {
    backgroundColor: COLORS.deep,
    paddingTop: 64,
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  greeting: { fontSize: 26, fontWeight: '800', color: '#fff' },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 6 },
  logoutButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 5,
  },
  cardLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: COLORS.muted },
  date: { fontSize: 24, fontWeight: '800', color: COLORS.darkText, marginTop: 10 },
  cardHint: { fontSize: 13, color: COLORS.muted, marginTop: 6 },
  errorText: { color: COLORS.danger, fontSize: 13, lineHeight: 19, marginTop: 10 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.deep,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    marginTop: 12,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 13, marginLeft: 6 },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 18,
    marginTop: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mapButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  mapButtonTitle: { fontSize: 17, fontWeight: '700', color: COLORS.darkText },
  mapButtonSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 17 },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    paddingVertical: 10,
  },
  textButtonLabel: { color: COLORS.muted, fontSize: 14, fontWeight: '600', marginLeft: 6 },
};