// NAP map: shows the NAP facilities around a point, coloured by how many lines
// are still free. Ported from the EBISU T&A app so both apps behave the same;
// NAP data comes from our own server, which proxies the NAP database.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, Callout, Circle } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { napsAPI, errorMessage } from '../services/api';
import { debounce, parseCoordinate, formatDateTime, distanceMeters } from '../utils/helpers';
import { COLORS } from '../theme';

const RADIUS_KM = 1;
const RADIUS_M = RADIUS_KM * 1000;
const NEARBY_LIMIT = 1000;
const MIN_REFRESH_DISTANCE_M = 50;
const LIVE_UPDATE_DISTANCE_M = 25;
const LIVE_UPDATE_INTERVAL_MS = 10000;
const NEARBY_REFRESH_DEBOUNCE_MS = 1200;

// Fallback view when the phone's location is unknown: Cebu City.
const DEFAULT_CENTER = { latitude: 10.3157, longitude: 123.8854 };

// 0 free lines = no capacity left, 1-8 = getting full, 9+ = plenty.
const getMarkerColor = (vacantLines) => {
  if (vacantLines === 0) return COLORS.danger;
  if (vacantLines <= 8) return COLORS.warning;
  return COLORS.success;
};

export default function NapMapScreen() {
  const [nearbyNaps, setNearbyNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [location, setLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [locating, setLocating] = useState(false);

  const [dataDate, setDataDate] = useState(null);
  const [dataDateError, setDataDateError] = useState(false);

  const mapRef = useRef(null);
  const nearbySeqRef = useRef(0);
  const locationRef = useRef(null);
  const lastFetchedCenterRef = useRef(null);
  const fetchNearbyNapsRef = useRef(null);
  const watcherRef = useRef(null);
  const isMountedRef = useRef(true);
  const myLocationBusyRef = useRef(false);

  // "Data last updated" comes from the NAP database itself, so the map never
  // pretends to be fresher than it is.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const loadStats = () => {
      napsAPI
        .getStats()
        .then((stats) => {
          if (cancelled) return;
          const value = stats.nap_report_date || stats.last_data_update;
          if (value) {
            setDataDate(value);
            setDataDateError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setDataDateError(true);
        });
    };

    loadStats();
    // The NAP API can be cold for a while; keep retrying for ~5 minutes.
    const retry = setInterval(() => {
      if (attempts++ >= 10) {
        clearInterval(retry);
        return;
      }
      loadStats();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  }, []);

  const fetchNearbyNaps = useCallback(async (lat, lng, opts = {}) => {
    const { silent = false } = opts;
    const seq = ++nearbySeqRef.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await napsAPI.getNearest({
        lat,
        lng,
        radius: RADIUS_KM,
        limit: NEARBY_LIMIT,
      });
      if (seq !== nearbySeqRef.current) return;
      setNearbyNaps(response.naps || []);
    } catch (fetchError) {
      if (seq !== nearbySeqRef.current) return;
      // Keep the map usable: show the message and let the user retry.
      setNearbyNaps([]);
      setError(errorMessage(fetchError));
    } finally {
      if (!silent && seq === nearbySeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNearbyNapsRef.current = fetchNearbyNaps;
  }, [fetchNearbyNaps]);

  const debouncedFetchNearby = useMemo(
    () =>
      debounce((lat, lng) => {
        if (!isMountedRef.current) return;
        lastFetchedCenterRef.current = { latitude: lat, longitude: lng };
        fetchNearbyNapsRef.current?.(lat, lng, { silent: true });
      }, NEARBY_REFRESH_DEBOUNCE_MS),
    []
  );

  const handleLivePosition = useCallback(
    (position) => {
      const coordinate = parseCoordinate(position?.coords?.latitude, position?.coords?.longitude);
      if (!coordinate) return;
      locationRef.current = coordinate;
      setLocation(coordinate);

      const lastCenter = lastFetchedCenterRef.current;
      if (!lastCenter || distanceMeters(lastCenter, coordinate) >= MIN_REFRESH_DISTANCE_M) {
        debouncedFetchNearby(coordinate.latitude, coordinate.longitude);
      }
    },
    [debouncedFetchNearby]
  );

  // Follow the user while the screen is open. 25 m / 10 s keeps it cheap but
  // responsive enough while walking.
  const startLiveWatcher = useCallback(async () => {
    if (watcherRef.current) return;
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LIVE_UPDATE_DISTANCE_M,
          timeInterval: LIVE_UPDATE_INTERVAL_MS,
        },
        handleLivePosition
      );
      if (!isMountedRef.current) {
        subscription?.remove?.();
        return;
      }
      watcherRef.current = subscription;
    } catch (watchError) {
      console.error('Location watch failed:', watchError);
    }
  }, [handleLivePosition]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      watcherRef.current?.remove?.();
      watcherRef.current = null;
    };
  }, []);

  const centerOn = useCallback((coordinate, delta = 0.01) => {
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: delta, longitudeDelta: delta }, 500);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          // Review Focus #2: the map still works, just without "near me".
          setPermissionDenied(true);
          setLoading(false);
          return;
        }
        setPermissionDenied(false);

        try {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (cancelled) return;
          const coordinate = parseCoordinate(position.coords.latitude, position.coords.longitude);
          if (coordinate) {
            locationRef.current = coordinate;
            lastFetchedCenterRef.current = coordinate;
            setLocation(coordinate);
            centerOn(coordinate);
            await fetchNearbyNaps(coordinate.latitude, coordinate.longitude);
          }
        } catch (positionError) {
          console.error('Could not read current position:', positionError);
          if (!cancelled) setLoading(false);
        }

        if (!cancelled) await startLiveWatcher();
      } catch (setupError) {
        console.error('Location setup failed:', setupError);
        if (!cancelled) setLoading(false);
      }
    };

    initialize();
    return () => {
      cancelled = true;
    };
  }, [centerOn, fetchNearbyNaps, startLiveWatcher]);

  const handleMyLocation = useCallback(async () => {
    if (myLocationBusyRef.current) return;
    myLocationBusyRef.current = true;
    setLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== 'granted') {
        setPermissionDenied(true);
        Alert.alert(
          'Location permission needed',
          'Please allow location access so the map can centre on your current position.'
        );
        return;
      }
      setPermissionDenied(false);

      let coordinate = null;
      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coordinate = parseCoordinate(position?.coords?.latitude, position?.coords?.longitude);
      } catch (positionError) {
        console.error('My location failed:', positionError);
      }
      if (!coordinate) coordinate = locationRef.current;

      if (!coordinate) {
        Alert.alert(
          'Location unavailable',
          "We couldn't find your current location. Make sure GPS is on and try again."
        );
        return;
      }

      locationRef.current = coordinate;
      lastFetchedCenterRef.current = coordinate;
      setLocation(coordinate);
      centerOn(coordinate);
      await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
      await startLiveWatcher();
    } finally {
      myLocationBusyRef.current = false;
      setLocating(false);
    }
  }, [centerOn, fetchNearbyNaps, startLiveWatcher]);

  const renderNapMarker = useCallback((nap) => {
    const coordinate = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
    if (!coordinate) return null;
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <Marker key={nap.id} coordinate={coordinate} pinColor={color}>
        <Callout>
          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>{nap.nap_id}</Text>
            <Text style={styles.calloutText} numberOfLines={2}>
              {nap.building_served || 'N/A'}
            </Text>
            <Text style={styles.calloutText}>Status: {nap.naps_status || 'N/A'}</Text>
            <Text style={[styles.calloutText, { color, fontWeight: '700' }]}>
              {nap.vacant_lines} of {nap.total_capacity} ports available
            </Text>
            {nap.distance_km !== undefined ? (
              <Text style={styles.calloutText}>{formatDistance(nap.distance_km)} away</Text>
            ) : null}
          </View>
        </Callout>
      </Marker>
    );
  }, []);

  const napMarkers = useMemo(() => nearbyNaps.map(renderNapMarker), [nearbyNaps, renderNapMarker]);

  const initialRegion = location
    ? { ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : { ...DEFAULT_CENTER, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  const radiusCenter = location;

  return (
    <View style={styles.container}>
      <View style={styles.searchStack}>
        <View style={styles.statusBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusText}>
              {nearbyNaps.length >= NEARBY_LIMIT
                ? `${nearbyNaps.length} NAPs within ${RADIUS_KM}km (limit ${NEARBY_LIMIT})`
                : `${nearbyNaps.length} NAP${nearbyNaps.length === 1 ? '' : 's'} within ${RADIUS_KM}km`}
            </Text>
            <Text style={[styles.dataDateText, dataDateError && !dataDate && styles.dataDateError]}>
              Data last updated:{' '}
              {dataDate ? formatDateTime(dataDate) : dataDateError ? "(can't reach server)" : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.legendRow}>
          <Legend color={COLORS.success} label="9+ vacant" />
          <Legend color={COLORS.warning} label="1–8 vacant" />
          <Legend color={COLORS.danger} label="0 vacant" />
        </View>

        {permissionDenied ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>
              Location permission denied. You can still search by place or coordinates, or tap the
              locate button.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                const center = locationRef.current || location || DEFAULT_CENTER;
                fetchNearbyNaps(center.latitude, center.longitude);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        followsUserLocation={false}
      >
        {radiusCenter ? (
          <Circle
            center={radiusCenter}
            radius={RADIUS_M}
            fillColor="rgba(200, 149, 108, 0.08)"
            strokeColor={COLORS.primary}
            strokeWidth={1}
          />
        ) : null}

        {napMarkers}
      </MapView>

      <TouchableOpacity
        style={styles.myLocationButton}
        onPress={handleMyLocation}
        activeOpacity={0.85}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel="My location"
        accessibilityHint="Centres the map on your current location"
      >
        {locating ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name="locate" size={22} color={COLORS.primary} />
        )}
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading nearby NAPs…</Text>
        </View>
      ) : null}
    </View>
  );
}

// "350m" or "1.24km" — short enough for the map callout.
function formatDistance(km) {
  if (km === null || km === undefined || Number.isNaN(Number(km))) return 'N/A';
  const value = Number(km);
  return value < 1 ? `${Math.round(value * 1000)}m` : `${value.toFixed(2)}km`;
}

function Legend({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  searchStack: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 20,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: { fontSize: 12, color: COLORS.muted, fontWeight: '500' },
  dataDateText: { fontSize: 10, color: COLORS.muted, marginTop: 2 },
  dataDateError: { color: COLORS.danger, fontWeight: '600' },
  legendRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  legendDot: { width: 9, height: 9, borderRadius: 5, marginRight: 5 },
  legendLabel: { fontSize: 10, color: COLORS.muted, fontWeight: '600' },
  noticeBanner: {
    marginTop: 6,
    backgroundColor: 'rgba(239, 246, 255, 0.97)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.info,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noticeText: { fontSize: 11, color: '#1d4ed8', lineHeight: 16 },
  errorBanner: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(254, 242, 242, 0.97)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.danger,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { flex: 1, fontSize: 11, color: '#b91c1c', lineHeight: 16 },
  retryButton: {
    marginLeft: 10,
    backgroundColor: COLORS.dark,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  myLocationButton: {
    position: 'absolute',
    right: 14,
    bottom: 30,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  callout: { padding: 8, minWidth: 150, maxWidth: 260 },
  calloutTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.dark },
  calloutText: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
  },
  loadingText: { marginTop: 12, fontSize: 14, color: COLORS.muted },
});
