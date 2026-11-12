// NAP map: shows the NAP facilities around a point, coloured by how many lines
// are still free. Ported from the EBISU T&A app so both apps behave the same;
// NAP data comes from our own server, which proxies the NAP database.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  FlatList,
} from 'react-native';
import MapView, { Marker, Callout, Circle, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import { napsAPI, errorMessage } from '../services/api';
import { fetchRoute } from '../services/routing';
import {
  debounce,
  parseCoordinate,
  parseCoordinateInput,
  formatDateTime,
  distanceMeters,
  copyToClipboard,
  formatLatLng,
} from '../utils/helpers';
import StatusBadge from '../components/StatusBadge';
import { COLORS } from '../theme';

const RADIUS_KM = 1;
const RADIUS_M = RADIUS_KM * 1000;
const NEARBY_LIMIT = 1000;
const MIN_REFRESH_DISTANCE_M = 50;
const LIVE_UPDATE_DISTANCE_M = 25;
const LIVE_UPDATE_INTERVAL_MS = 10000;
const NEARBY_REFRESH_DEBOUNCE_MS = 1200;
// Short pause after typing so "Cebu City" is one request, not nine. Kept at the
// EBISU T&A value (350 ms) so the search feels the same in both apps.
const SEARCH_DEBOUNCE_MS = 350;

// Fallback view when the phone's location is unknown: Cebu City.
const DEFAULT_CENTER = { latitude: 10.3157, longitude: 123.8854 };

// Status chips shown in nearby view. The server doesn't filter nearest results
// by status, so these are applied client-side to the list overlay; markers on
// the map stay as-is (they reflect reality, not a filtered subset).
const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'In Service', value: 'In Service' },
  { label: 'Out of Service', value: 'Defective' },
  { label: 'Planned', value: 'Planned' },
];

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

  // Search: text queries hit the NAP database; coordinate queries just move
  // the map (no request needed).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [coordinateSearchResult, setCoordinateSearchResult] = useState(null);
  const [searchMarker, setSearchMarker] = useState(null);

  // Long-press drops a pin somewhere the user is not standing, so they can
  // check capacity around a building they are about to visit.
  const [droppedPin, setDroppedPin] = useState(null);
  // Tapping a marker picks it for the details card and the walking route.
  const [selectedNap, setSelectedNap] = useState(null);
  const [routePoints, setRoutePoints] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  // The nearby list overlay vs map; toggleable so the owner can scan many NAPs
  // without closing each callout one at a time.
  const [showList, setShowList] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  // Status filter applied client-side in nearby view; only affects the list,
  // not the map markers (markers always reflect actual status).
  const [statusFilter, setStatusFilter] = useState('');

  const mapRef = useRef(null);
  const nearbySeqRef = useRef(0);
  const napSeqRef = useRef(0);
  const lastFlushRef = useRef({ query: null, at: 0 });
  const locationRef = useRef(null);
  const droppedPinRef = useRef(null);
  const isSearchingRef = useRef(false);
  const lastRouteRef = useRef({ napId: null, origin: null });
  const lastFetchedCenterRef = useRef(null);
  const fetchNearbyNapsRef = useRef(null);
  const watcherRef = useRef(null);
  const isMountedRef = useRef(true);
  const myLocationBusyRef = useRef(false);

  // The live-position callback cannot read state without going stale, so the
  // two flags it cares about are mirrored into refs.
  useEffect(() => {
    isSearchingRef.current = isSearching;
  }, [isSearching]);

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

      // While a pin is dropped or a search is on screen, the map belongs to
      // that view — walking a few metres must not yank the results back.
      if (droppedPinRef.current || isSearchingRef.current) return;

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

  const performNapSearch = useCallback(async (query) => {
    const q = String(query || '').trim();
    // A single character matches almost everything in the database; wait for two.
    if (q.length < 2) {
      napSeqRef.current++;
      setSearchResults([]);
      setIsSearching(false);
      setSearchError('');
      return;
    }

    const seq = ++napSeqRef.current;
    setSearching(true);
    setSearchError('');
    try {
      const response = await napsAPI.search({ q, limit: 100 });
      if (seq !== napSeqRef.current) return;
      setSearchResults(response.naps || []);
    } catch (searchFailure) {
      if (seq !== napSeqRef.current) return;
      setSearchResults([]);
      setSearchError(errorMessage(searchFailure));
    } finally {
      if (seq === napSeqRef.current) setSearching(false);
    }
  }, []);

  const debouncedSearch = useMemo(
    () =>
      debounce((query) => {
        // Pressing Enter already searched this exact text; don't repeat it.
        const lastFlush = lastFlushRef.current;
        if (lastFlush.query === query && Date.now() - lastFlush.at < 700) return;
        performNapSearch(query);
      }, SEARCH_DEBOUNCE_MS),
    [performNapSearch]
  );

  const handleSearchChange = (text) => {
    setSearchQuery(text);

    // A coordinate is not a place name: move the map instead of searching.
    const coordinate = parseCoordinateInput(text);
    if (coordinate) {
      napSeqRef.current++;
      debouncedSearch.cancel();
      setIsSearching(false);
      setSearchResults([]);
      setSearchError('');
      setSearchMarker(coordinate);
      setCoordinateSearchResult(coordinate);
      centerOn(coordinate);
      return;
    }

    setSearchMarker(null);
    setCoordinateSearchResult(null);
    setIsSearching(text.trim().length >= 2);
    if (text.trim().length < 2) {
      napSeqRef.current++;
      setSearchResults([]);
      setSearchError('');
      debouncedSearch.cancel();
      return;
    }
    debouncedSearch(text);
  };

  const handleSubmitEditing = () => {
    Keyboard.dismiss();
    if (coordinateSearchResult) {
      centerOn(coordinateSearchResult);
      return;
    }
    const q = searchQuery.trim();
    if (q.length >= 2) {
      lastFlushRef.current = { query: q, at: Date.now() };
      performNapSearch(q);
    }
  };

  const clearSearch = useCallback(() => {
    debouncedSearch.cancel();
    napSeqRef.current++;
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setSearchError('');
    setCoordinateSearchResult(null);
    setSearchMarker(null);
  }, [debouncedSearch]);

  // --- Dropped pin and walking directions ----------------------------------

  const selectNap = useCallback((nap) => {
    Keyboard.dismiss();
    setSelectedNap(nap);
  }, []);

  const handleMapLongPress = useCallback(
    async (event) => {
      const coordinate = parseCoordinate(
        event?.nativeEvent?.coordinate?.latitude,
        event?.nativeEvent?.coordinate?.longitude
      );
      if (!coordinate) return;

      // A new spot means new surroundings; the old directions no longer apply.
      clearSearch();
      setSelectedNap(null);
      setRoutePoints([]);
      setRouteDistanceKm(null);
      setRouteError('');
      droppedPinRef.current = coordinate;
      setDroppedPin(coordinate);
      lastFetchedCenterRef.current = coordinate;
      centerOn(coordinate, 0.02);
      await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
    },
    [centerOn, clearSearch, fetchNearbyNaps]
  );

  // Dragging the pin moves the pin only; the nearby list refreshes once the
  // finger is lifted, not on every pixel.
  const handlePinDrag = useCallback((event) => {
    const coordinate = parseCoordinate(
      event?.nativeEvent?.coordinate?.latitude,
      event?.nativeEvent?.coordinate?.longitude
    );
    if (!coordinate) return;
    droppedPinRef.current = coordinate;
    setDroppedPin(coordinate);
  }, []);

  const handlePinDragEnd = useCallback(
    async (event) => {
      const coordinate = parseCoordinate(
        event?.nativeEvent?.coordinate?.latitude,
        event?.nativeEvent?.coordinate?.longitude
      );
      if (!coordinate) return;
      droppedPinRef.current = coordinate;
      setDroppedPin(coordinate);
      lastFetchedCenterRef.current = coordinate;
      await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
    },
    [fetchNearbyNaps]
  );

  const clearPin = useCallback(async () => {
    droppedPinRef.current = null;
    setDroppedPin(null);
    setRoutePoints([]);
    setRouteDistanceKm(null);
    setRouteError('');
    const current = locationRef.current || location;
    if (current) {
      lastFetchedCenterRef.current = current;
      centerOn(current);
      await fetchNearbyNaps(current.latitude, current.longitude, { silent: true });
    }
  }, [centerOn, fetchNearbyNaps, location]);

  // Directions are recalculated only when the target changes or the starting
  // point really moves — every route costs one request.
  useEffect(() => {
    const destination = selectedNap
      ? parseCoordinate(selectedNap.dp_nap_lat, selectedNap.dp_nap_long)
      : null;
    // Priority: dropped pin, then coordinate search, then the user's position.
    const origin = droppedPin || searchMarker || location;

    if (!destination || !origin) {
      setRoutePoints([]);
      setRouteDistanceKm(null);
      setRouteLoading(false);
      setRouteError('');
      lastRouteRef.current = { napId: null, origin: null };
      return undefined;
    }

    const napId = selectedNap?.id ?? null;
    const previous = lastRouteRef.current;
    const sameTarget = previous.napId === napId;
    const originMoved =
      !previous.origin || distanceMeters(previous.origin, origin) >= MIN_REFRESH_DISTANCE_M;
    if (sameTarget && !originMoved) return undefined;
    lastRouteRef.current = { napId, origin };

    let cancelled = false;
    setRouteLoading(true);
    setRouteError('');
    fetchRoute(origin, destination)
      .then((route) => {
        if (cancelled) return;
        setRoutePoints(route.points || []);
        setRouteDistanceKm(route.distanceKm);
      })
      .catch(() => {
        if (cancelled) return;
        // No line is better than a wrong line; the card falls back to the
        // straight-line distance that came with the NAP record.
        setRoutePoints([]);
        setRouteDistanceKm(null);
        setRouteError('Walking route unavailable.');
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNap, droppedPin, searchMarker, location]);

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

  const renderNapMarker = useCallback(
    (nap) => {
      const coordinate = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
      if (!coordinate) return null;
      const color = getMarkerColor(nap.vacant_lines);
      return (
        <Marker
          key={nap.id}
          coordinate={coordinate}
          pinColor={color}
          onPress={() => selectNap(nap)}
        >
          <Callout onPress={() => selectNap(nap)}>
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
    },
    [selectNap]
  );

  const displayNaps = isSearching ? searchResults : nearbyNaps;
  // Status chips only make sense in nearby view, not during a text search (the
  // server already handles status there). Client-side filter keeps it cheap.
  const listNaps =
    !isSearching && statusFilter
      ? displayNaps.filter((nap) => nap.naps_status === statusFilter)
      : displayNaps;
  const napMarkers = useMemo(() => displayNaps.map(renderNapMarker), [displayNaps, renderNapMarker]);

  const initialRegion = location
    ? { ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : { ...DEFAULT_CENTER, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  // The 1 km circle marks where the nearby list was taken from: the pin when
  // one is dropped, otherwise the user.
  const radiusCenter = droppedPin || location;
  const showNoResults =
    isSearching && !searching && !searchError && searchResults.length === 0 && searchQuery.trim().length >= 2;

  // Distance line for the selected NAP: the walking route once it arrives,
  // otherwise the straight-line figure that came with the record.
  const routeDistanceText = routeLoading
    ? 'Measuring walking route…'
    : routeDistanceKm !== null && routeDistanceKm !== undefined
      ? `${Number(routeDistanceKm).toFixed(2)} km walk`
      : selectedNap?.distance_km !== undefined && selectedNap?.distance_km !== null
        ? `${formatDistance(selectedNap.distance_km)} direct`
        : null;

  return (
    <View style={styles.container}>
      <View style={styles.searchStack}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={COLORS.muted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search NAPs, place, or coordinates…"
            placeholderTextColor={COLORS.muted}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onSubmitEditing={handleSubmitEditing}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search NAPs or coordinates"
          />
          {searching ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={clearSearch}
              style={styles.clearButton}
              accessibilityLabel="Clear search"
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.statusBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusText}>
              {isSearching
                ? `${searchResults.length} search result${searchResults.length === 1 ? '' : 's'}`
                : droppedPin
                  ? `${nearbyNaps.length} NAP${nearbyNaps.length === 1 ? '' : 's'} within ${RADIUS_KM}km of pin`
                  : nearbyNaps.length >= NEARBY_LIMIT
                    ? `${nearbyNaps.length} NAPs within ${RADIUS_KM}km (limit ${NEARBY_LIMIT})`
                    : `${nearbyNaps.length} NAP${nearbyNaps.length === 1 ? '' : 's'} within ${RADIUS_KM}km`}
            </Text>
            <Text style={[styles.dataDateText, dataDateError && !dataDate && styles.dataDateError]}>
              Data last updated:{' '}
              {dataDate ? formatDateTime(dataDate) : dataDateError ? "(can't reach server)" : '—'}
            </Text>
          </View>
          {/* Toggle between map view and scrollable list view. Only shown in nearby mode
              — during text search the results are rendered as markers, same as nearby. */}
          {!isSearching ? (
            <TouchableOpacity
              style={styles.listToggle}
              onPress={() => setShowList((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showList ? 'Switch to map view' : 'Switch to list view'}
            >
              <Text style={styles.listToggleText}>{showList ? '🗺️ Map' : '📋 List'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Status filter chips — only meaningful when looking at the nearby set; the
            text-search path already filters on the server via the status param. */}
        {!isSearching ? (
          <View style={styles.chipsRow}>
            {STATUS_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.value || 'all'}
                style={[styles.chip, statusFilter === f.value && styles.chipActive]}
                onPress={() => setStatusFilter(f.value)}
                accessibilityRole="button"
                accessibilityLabel={`Filter: ${f.label}`}
              >
                <Text
                  style={[styles.chipText, statusFilter === f.value && styles.chipTextActive]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

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

        {coordinateSearchResult ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>
              Showing coordinates {coordinateSearchResult.latitude.toFixed(5)},{' '}
              {coordinateSearchResult.longitude.toFixed(5)}
            </Text>
          </View>
        ) : null}

        {droppedPin && !isSearching ? (
          <View style={styles.pinBanner}>
            <Text style={styles.pinBannerText}>Pinned spot — checking around here</Text>
            <TouchableOpacity onPress={clearPin} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.pinBannerClear}>Clear ✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showNoResults ? (
          <View style={styles.noticeBanner}>
            <Text style={styles.noticeText}>No NAPs match “{searchQuery.trim()}”.</Text>
          </View>
        ) : null}

        {searchError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{searchError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => performNapSearch(searchQuery)}
              activeOpacity={0.8}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
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
        onLongPress={handleMapLongPress}
      >
        {radiusCenter && !isSearching ? (
          <Circle
            center={radiusCenter}
            radius={RADIUS_M}
            fillColor="rgba(200, 149, 108, 0.08)"
            strokeColor={COLORS.primary}
            strokeWidth={1}
          />
        ) : null}

        {droppedPin ? (
          <Marker
            coordinate={droppedPin}
            pinColor={COLORS.pin}
            draggable
            onDrag={handlePinDrag}
            onDragEnd={handlePinDragEnd}
            accessibilityLabel="Pinned search location"
          />
        ) : null}

        {searchMarker ? (
          <Marker coordinate={searchMarker} pinColor={COLORS.pin} />
        ) : null}

        {routePoints.length > 1 ? (
          <Polyline coordinates={routePoints} strokeColor={COLORS.info} strokeWidth={4} />
        ) : null}

        {napMarkers}
      </MapView>

      {/* List view — shown when the owner toggles away from the map so they can
          scroll through many NAPs without closing each callout one at a time. */}
      {showList ? (
        <View style={styles.listContainer}>
          <FlatList
            data={listNaps}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderNapListItem}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={5}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View style={{ height: 140, paddingHorizontal: 16, paddingTop: 12 }}>
                <TouchableOpacity onPress={() => setShowList(false)} style={styles.closeListBtn}>
                  <Text style={styles.closeListBtnText}>🗺️ Back to map</Text>
                </TouchableOpacity>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={styles.emptyListText}>
                  {isSearching ? 'No search results' : 'No NAPs nearby'}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}

      {/* Selected NAP — collapsed bar or full detail panel */}
      {selectedNap && !detailsExpanded ? (
        <TouchableOpacity
          style={styles.collapsedBar}
          onPress={() => setDetailsExpanded(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Tap to expand NAP details"
        >
          <View
            style={[styles.statusDot, { backgroundColor: getMarkerColor(selectedNap.vacant_lines) }]}
          />
          <View style={styles.collapsedInfo}>
            <Text style={styles.collapsedTitle} numberOfLines={1}>{selectedNap.nap_id}</Text>
            <Text style={styles.collapsedSub} numberOfLines={1}>
              {[selectedNap.building_served, routeDistanceText].filter(Boolean).join(' · ') || 'N/A'}
            </Text>
          </View>
          <StatusBadge status={selectedNap.naps_status} />
          <Text style={styles.expandText}>▲ Details</Text>
        </TouchableOpacity>
      ) : null}

      {selectedNap && detailsExpanded ? (
        <View style={styles.detailPanel}>
          <TouchableOpacity
            onPress={() => setSelectedNap(null)}
            style={styles.closeDetailBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close details"
          >
            <Text style={styles.closeDetailBtnText}>✕</Text>
          </TouchableOpacity>

          <View style={styles.detailHeader}>
            <View
              style={[styles.statusDot, { backgroundColor: getMarkerColor(selectedNap.vacant_lines) }]}
            />
            <View style={styles.detailTitleContainer}>
              <Text style={styles.detailTitle}>{selectedNap.nap_id}</Text>
              <Text style={styles.detailSubtitle}>{selectedNap.location_type || 'N/A'}</Text>
            </View>
            <StatusBadge status={selectedNap.naps_status} size="lg" />
          </View>

          <View style={styles.detailInfo}>
            <InfoRow label="Building" value={selectedNap.building_served || 'N/A'} />
            <InfoRow label="Floors" value={selectedNap.floors_served || 'N/A'} />
            <InfoRow label="City" value={selectedNap.city_name || 'N/A'} />
            <InfoRow label="Province" value={selectedNap.province_name || 'N/A'} />
            <InfoRow label="OLT / Cabinet" value={selectedNap.cabinet || 'N/A'} />
            <InfoRow label="Status" value={selectedNap.naps_status || 'N/A'} />
            <InfoRow
              label="Coordinates"
              value={formatLatLng(selectedNap.dp_nap_lat, selectedNap.dp_nap_long)}
              onCopy={async () => copyToClipboard(formatLatLng(selectedNap.dp_nap_lat, selectedNap.dp_nap_long))}
            />
            {!routeLoading && routeDistanceKm === null &&
              selectedNap.distance_km !== undefined && (
              <InfoRow
                label="Distance"
                value={`${formatDistance(selectedNap.distance_km)} direct`}
              />
            )}
            {routeLoading && <InfoRow label="Distance" value="Measuring walking route…" />}
            {!routeLoading && routeDistanceKm !== null && routeDistanceKm !== undefined && (
              <InfoRow
                label="Walking distance"
                value={
                  routeDistanceKm < 1
                    ? `${Math.round(routeDistanceKm * 1000)}m`
                    : `${routeDistanceKm.toFixed(2)}km`
                }
              />
            )}
          </View>

          <View style={styles.portsGrid}>
            <PortBox label="Total" value={selectedNap.total_capacity} color={COLORS.dark} />
            <PortBox label="Working" value={selectedNap.working_lines} color={COLORS.success} />
            <PortBox
              label="Available"
              value={selectedNap.vacant_lines}
              color={getMarkerColor(selectedNap.vacant_lines)}
            />
          </View>

          <TouchableOpacity
            onPress={() => setDetailsExpanded(false)}
            style={styles.collapseBtn}
            accessibilityRole="button"
            accessibilityLabel="Collapse details"
          >
            <Text style={styles.collapseBtnText}>▼ Show less (see map)</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.myLocationButton, selectedNap && { bottom: 150 }]}
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

// Row inside the details panel. Long-pressing the value copies it so the owner
// can drop the coordinates into a navigation app or notes.
function InfoRow({ label, value, onCopy }) {
  return (
    <TouchableOpacity
      style={styles.infoRow}
      onLongPress={onCopy}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Long press to copy.`}
    >
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </TouchableOpacity>
  );
}

// Three coloured boxes in the detail panel showing total / working / available.
function PortBox({ label, value, color }) {
  return (
    <View style={styles.portBox}>
      <Text style={[styles.portValue, { color }] || styles.portValue}>{value}</Text>
      <Text style={styles.portLabel}>{label}</Text>
    </View>
  );
}

// One row inside the nearby list. Tapping it selects the NAP on the map.
const renderNapListItem = useCallback(
  ({ item: nap }) => {
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <TouchableOpacity
        style={styles.listItem}
        onPress={() => {
          if (mapRef.current && nap.dp_nap_lat && nap.dp_nap_long) {
            const c = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
            if (c) mapRef.current.animateToRegion({ ...c, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 500);
          }
          selectNap(nap);
          setShowList(false);
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <View style={styles.listItemContent}>
          <View style={styles.listItemTitleRow}>
            <Text style={styles.listItemTitle} numberOfLines={1}>{nap.nap_id}</Text>
            <StatusBadge status={nap.naps_status} />
          </View>
          <Text style={styles.listItemSubtitle} numberOfLines={1}>
            {[nap.building_served, formatDistance(nap.distance_km)].filter(Boolean).join(' · ') || 'N/A'}
          </Text>
          <Text style={styles.listItemField}>
            <Text style={styles.listItemFieldLabel}>Cabinet:</Text>{' '}
            {nap.cabinet || 'N/A'}
          </Text>
          <Text style={styles.listItemField}>
            <Text style={styles.listItemFieldLabel}>Capacity:</Text>{' '}
            <Text style={{ color }}>{nap.vacant_lines} of {nap.total_capacity} ports free</Text>
          </Text>
        </View>
      </TouchableOpacity>
    );
  },
  [selectNap]
);

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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  searchInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: COLORS.dark },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  clearButtonText: { fontSize: 12, color: COLORS.muted, fontWeight: 'bold' },
  pinBanner: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 243, 255, 0.97)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.pin,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pinBannerText: { fontSize: 11, color: COLORS.pin, fontWeight: '700' },
  pinBannerClear: { fontSize: 11, color: COLORS.danger, fontWeight: '700' },
  selectedCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    zIndex: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center' },
  selectedDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  selectedTitle: { fontSize: 14, fontWeight: '800', color: COLORS.dark },
  selectedSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 3 },
  selectedClose: { padding: 6, marginLeft: 8 },
  selectedCloseText: { fontSize: 13, color: COLORS.muted, fontWeight: 'bold' },
  selectedRouteError: { fontSize: 11, color: COLORS.danger, marginTop: 8 },
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
  // Status filter chips
  chipsRow: {
    marginTop: 6,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    marginRight: 6,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 11, color: COLORS.muted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  // List toggle button in status bar
  listToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.dark,
    borderRadius: 6,
    marginLeft: 8,
    alignSelf: 'center',
  },
  listToggleText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  // Full-screen list overlay
  listContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 15,
  },
  listContent: { flexGrow: 1 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  listItemContent: { flex: 1 },
  listItemTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listItemTitle: { fontSize: 14, fontWeight: '600', color: COLORS.dark, flexShrink: 1, marginRight: 8 },
  listItemSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  listItemField: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  listItemFieldLabel: { color: COLORS.dark, fontWeight: '600' },
  closeListBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  closeListBtnText: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },
  emptyList: { padding: 40, alignItems: 'center' },
  emptyListText: { fontSize: 14, color: COLORS.muted },
  // Collapsed selected-NAP bar
  collapsedBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  collapsedInfo: { flex: 1, marginHorizontal: 10 },
  collapsedTitle: { fontSize: 14, fontWeight: '800', color: COLORS.dark },
  collapsedSub: { fontSize: 12, color: COLORS.muted, marginTop: 3 },
  expandText: { fontSize: 11, color: COLORS.primary, fontWeight: '700', marginLeft: 8 },
  // Expanded detail panel
  detailPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 24,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    zIndex: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
    maxHeight: '65%',
  },
  closeDetailBtn: { position: 'absolute', right: 12, top: 10 },
  closeDetailBtnText: { fontSize: 16, color: COLORS.muted, fontWeight: 'bold' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  detailTitleContainer: { flex: 1, marginHorizontal: 10 },
  detailTitle: { fontSize: 16, fontWeight: '800', color: COLORS.dark },
  detailSubtitle: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  detailInfo: {},
  infoRow: { paddingVertical: 7 },
  infoLabel: { fontSize: 11, color: COLORS.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 14, color: COLORS.dark, marginTop: 2 },
  portsGrid: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 10,
    gap: 8,
  },
  portBox: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  portValue: { fontSize: 18, fontWeight: '800', color: COLORS.dark },
  portLabel: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  collapseBtn: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderColor: COLORS.border,
    marginTop: 2,
  },
  collapseBtnText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
});
