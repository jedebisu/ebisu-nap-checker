import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../services/api';

const timeOfDay = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
};

export default function DashboardScreen({ onOpenMap, onLogout }) {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.napsAPI.getStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const greeting = `Good ${timeOfDay()}, ${user?.firstname || 'User'}`;
  const lastUpdate = stats?.nap_report_date || stats?.last_data_update || 'Unknown';
  const lastUpdateDate = new Date(lastUpdate);
  const lastUpdateText = isNaN(lastUpdateDate) ? 'Unknown' : lastUpdateDate.toLocaleDateString();

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.greeting}>{greeting}</Text>
      </View>
      <View style={styles.card}>
        {loading ? <ActivityIndicator color="#00539B" /> : (
          <>
            <Text style={styles.label}>Database Last Updated</Text>
            <Text style={styles.value}>{lastUpdateText}</Text>
            <Text style={styles.sub}>{stats?.total_naps?.toLocaleString()} facilities</Text>
          </>
        )}
      </View>
      <TouchableOpacity style={styles.btn} onPress={onOpenMap} accessibilityRole="button">
        <Text style={styles.btnText}>Open NAP Map</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.logout} onPress={onLogout} accessibilityRole="button">
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E5F0FA' },
  hero: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 28, backgroundColor: '#003A6B', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  greeting: { color: '#fff', fontSize: 26, fontWeight: '800' },
  card: { marginHorizontal: 24, marginTop: -20, backgroundColor: '#fff', borderRadius: 16, padding: 20, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, flexDirection: 'column', gap: 6 },
  label: { color: '#00539B', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  value: { color: '#003A6B', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { color: '#4b5563', fontSize: 14, fontWeight: '600' },
  btn: { marginHorizontal: 24, marginTop: 28, backgroundColor: '#00539B', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  logout: { alignSelf: 'flex-end', marginRight: 24, marginTop: 16, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  logoutText: { color: '#4b5563', fontSize: 14, fontWeight: '600' },
});
