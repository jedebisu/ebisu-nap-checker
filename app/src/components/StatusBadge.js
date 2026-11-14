import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getNapStatusColor, getNapStatusTextColor } from '../utils/helpers';

const STATUS_TINT = {
  'In Service': '#dcfce7',
  'Planned': '#dbeafe',
  'Defective': '#fee2e2',
  'Installed': '#f5f3ff',
};

const StatusBadge = ({ status, size = 'sm' }) => {
  const bgColor = STATUS_TINT[status] || '#f3f4f6';
  const textColor = getNapStatusTextColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: bgColor }, size === 'lg' && styles.badgeLg]}>
      <Text style={[styles.text, { color: textColor }, size === 'lg' && styles.textLg]}>
        {status || 'Unknown'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeLg: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
  },
  textLg: {
    fontSize: 12,
  },
});

export default StatusBadge;
