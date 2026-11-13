import AsyncStorage from '@react-native-async-storage/async-storage';

const NAPS_UPDATED_KEY = 'cached_naps_updated_at';

const cacheNapsUpdatedAt = async (value) => {
  try {
    if (value) await AsyncStorage.setItem(NAPS_UPDATED_KEY, value);
  } catch (error) {
    console.error('Error caching naps updated_at:', error);
  }
};

const getCachedNapsUpdatedAt = async () => {
  try {
    return await AsyncStorage.getItem(NAPS_UPDATED_KEY);
  } catch (error) {
    return null;
  }
};

export { cacheNapsUpdatedAt, getCachedNapsUpdatedAt };
export default { cacheNapsUpdatedAt, getCachedNapsUpdatedAt };
