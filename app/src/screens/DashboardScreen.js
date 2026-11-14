import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, FlatList } from 'react-native';
import { useAuth } from '../context/AuthContext';
import * as api from '../services/api';
import StatusBadge from '../components/StatusBadge';

const timeOfDay = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
};

export default function DashboardScreen({ onOpenMap, onOpenNap, onLogout }) {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newNaps, setNewNaps] = useState([]);
  const [loadingNew, setLoadingNew] = useState(false);
  const [showNewNaps, setShowNewNaps] = useState(false);

  useEffect(() => {
    api.napsAPI.getStats().then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const fetchNewNaps = async () => {
      setLoadingNew(true);
      try {
        const response = await api.napsAPI.getNew({ limit: 1000 });
        const naps = response?.naps || [];
        setNewNaps(naps);
        // If there are new NAPs since last import, auto-show the section.
        setShowNewNaps(naps.length > 0);
      } catch (e) {
        // Silently ignore — new NAPs section is best-effort.
        setNewNaps([]);
        setShowNewNaps(false);
      } finally {
        setLoadingNew(false);
      }
    };
    fetchNewNaps();
  }, []);

  const greeting = `Good ${timeOfDay()}, ${user?.firstname || 'User'}`;
  const lastUpdate = stats?.nap_report_date || stats?.last_data_update || 'Unknown';
  const lastUpdateDate = new Date(lastUpdate);
  const lastUpdateText = isNaN(lastUpdateDate) ? 'Unknown' : lastUpdateDate.toLocaleDateString();

  const renderNewNapItem = ({ item: nap }) => {
    const color = nap.vacant_lines === 0 ? '#ef4444' : nap.vacant_lines <= 8 ? '#f59e0b' : '#22c55e';
    return (
      <TouchableOpacity
        style={styles.newNapItem}
        onPress={() => {
          if (onOpenNap) onOpenNap(nap);
          else if (onOpenMap) onOpenMap();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${nap.nap_id} on map`}
      >
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <View style={styles.newNapContent}>
          <View style={styles.newNapTitleRow}>
            <Text style={styles.newNapTitle} numberOfLines={1}>{nap.nap_id}</Text>
            <StatusBadge status={nap.naps_status} />
          </View>
          <Text style={styles.newNapSubtitle} numberOfLines={1}>{nap.building_served || 'N/A'}</Text>
          <Text style={styles.newNapMeta}>
            {nap.city_name || 'N/A'} · {nap.vacant_lines} of {nap.total_capacity} ports available
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

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

      {/* NEW NAPs section — shown in the previously blank space below the stats */}
      <View style={styles.newNapsSection}>
        <TouchableOpacity
          style={styles.newNapsHeader}
          onPress={() => setShowNewNaps(!showNewNaps)}
          accessibilityRole="button"
          accessibilityLabel={`New NAPs since last update${newNaps.length ? `: ${newNaps.length}` : ''}`}
        >
          <Text style={styles.newNapsHeaderText}>
            ✨ NEW NAPS SINCE LAST UPDATE{newNaps.length > 0 ? `: ${newNaps.length}` : ''}
          </Text>
          <Text style={styles.newNapsHeaderChevron}>{showNewNaps ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showNewNaps && (
          <View style={styles.newNapsCard}>
            {loadingNew ? (
              <ActivityIndicator color="#00539B" />
            ) : newNaps.length === 0 ? (
              <Text style={styles.newNapsEmpty}>No new NAPs found — database is up to date.</Text>
            ) : (
              <FlatList
                data={newNaps}
                keyExtractor={(item) => item.nap_id}
                renderItem={renderNewNapItem}
                contentContainerStyle={styles.newNapsList}
                ItemSeparatorComponent={() => <View style={styles.newNapDivider} />}
                ListEmptyComponent={null}
              />
            )}
          </View>
        )}
      </View>
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

  newNapsSection: { marginTop: 28, marginHorizontal: 24, marginBottom: 32 },
  newNapsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#00539B', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16 },
  newNapsHeaderText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  newNapsHeaderChevron: { color: '#fff', fontSize: 12, fontWeight: '700' },

  newNapsCard: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4 },
  newNapsList: { paddingVertical: 4 },
  newNapsEmpty: { padding: 20, color: '#6b7280', fontSize: 13, textAlign: 'center' },

  newNapItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  newNapContent: { flex: 1 },
  newNapTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newNapTitle: { fontSize: 14, fontWeight: '600', color: '#1a1d23', flexShrink: 1, marginRight: 8 },
  newNapSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  newNapMeta: { fontSize: 11, color: '#4b5563', marginTop: 2 },
  newNapDivider: { height: 1, backgroundColor: '#e5e7eb', marginHorizontal: 14 },
});
