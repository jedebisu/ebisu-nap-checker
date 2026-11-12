// Pure helpers shared by the screens. Kept free of React and of any network
// calls so they can be unit-tested and reasoned about on their own.
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';

// Delays `func` until `wait` ms after the last call. Used by the map search box
// so typing "Cebu City" fires one request, not nine.
export const debounce = (func, wait) => {
  let timeout;
  const executedFunction = (...args) => {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
  // Lets callers drop a pending call, e.g. when the search box is cleared.
  executedFunction.cancel = () => clearTimeout(timeout);
  return executedFunction;
};

// Great-circle distance in metres between two {latitude, longitude} points.
// Good enough for "which NAP is nearest" at 1 km scale.
export const distanceMeters = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};

export const parseCoordinate = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
};

// Accepts the three shapes people actually paste into a search box:
//   10.3157, 123.8854            (decimal degrees)
//   10°18'56.5"N 123°53'07.4"E   (degrees/minutes/seconds)
//   101856N 1235307E             (compact DMS)
// Returns null when the text is a place name instead, so the caller knows to
// run a normal text search.
export const parseCoordinateInput = (input) => {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Try decimal degrees: "10.3157, 123.8854" or "10.3157 123.8854"
  const decimalMatch = trimmed.match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lng = parseFloat(decimalMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'decimal' };
    }
  }

  // Try DMS: "10°18'56.5"N 123°53'07.4"E"
  const dmsLatMatch = trimmed.match(/(-?\d+)(?:°|\s*deg)?\s*(\d{1,2})['′]\s*(\d+(?:\.\d+)?)["″]?\s*([NnSs])/);
  const dmsLngMatch = trimmed.match(/(-?\d+)(?:°|\s*deg)?\s*(\d{1,2})['′]\s*(\d+(?:\.\d+)?)["″]?\s*([EeWw])/);
  if (dmsLatMatch && dmsLngMatch) {
    const lat = dmsToDecimal(dmsLatMatch[1], dmsLatMatch[2], dmsLatMatch[3], dmsLatMatch[4]);
    const lng = dmsToDecimal(dmsLngMatch[1], dmsLngMatch[2], dmsLngMatch[3], dmsLngMatch[4]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'dms' };
    }
  }

  // Try DDMMSS compact: "101856N 1235307E"
  const compactMatch = trimmed.match(/(-?\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*([NnSs])\s*(-?\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EeWw])/);
  if (compactMatch) {
    const lat = compactToDecimal(compactMatch[1], compactMatch[2], compactMatch[3], compactMatch[4]);
    const lng = compactToDecimal(compactMatch[5], compactMatch[6], compactMatch[7], compactMatch[8]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'dms-compact' };
    }
  }

  return null;
};

const dmsToDecimal = (deg, min, sec, dir) => {
  const decimal = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec || 0) / 3600;
  return dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W' ? -decimal : decimal;
};

const compactToDecimal = (deg, min, sec, dir) => {
  const decimal = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec) / 3600;
  return dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W' ? -decimal : decimal;
};

export const formatCoords = (lat, lng, dp = 6) => {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return 'N/A';
  return `${latNum.toFixed(dp)}, ${lngNum.toFixed(dp)}`;
};

// Same as formatCoords but always 6 decimal places — the shape used in the
// NAP details card, where the string is copied to the clipboard verbatim.
export const formatLatLng = (lat, lng) => formatCoords(lat, lng, 6);

// Copies text and tells the user. Alerts are part of the UX here (the owner
// asked for a visible confirmation), so this helper is the one exception to
// "pure helpers only" in this file.
export const copyToClipboard = async (text) => {
  try {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Copied to clipboard');
  } catch {
    Alert.alert('Copy failed', 'Could not copy to clipboard');
  }
};

export const NAP_STATUS_COLORS = {
  'In Service': '#22c55e',
  Planned: '#3b82f6',
  Defective: '#ef4444',
  Installed: '#a855f7',
};

export const getNapStatusColor = (status) => NAP_STATUS_COLORS[status] || '#6b7280';

export const formatDateTime = (iso) => {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

// Formats a plain calendar date such as "2026-11-10". Split by hand instead of
// new Date(iso): a date-only string is parsed as UTC midnight, which would show
// the previous day in any timezone west of Greenwich.
export const formatDate = (value) => {
  if (!value) return 'N/A';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const fallback = new Date(value);
    return isNaN(fallback.getTime()) ? String(value) : fallback.toLocaleDateString('en-US');
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
