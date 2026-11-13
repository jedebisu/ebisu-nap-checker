import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'https://ebisu-nap-checker.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (credentials) => {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  },

  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },

  register: async (payload) => {
    const response = await api.post('/auth/register', payload);
    return response.data;
  },

  verifyOtp: async (payload) => {
    const response = await api.post('/auth/verify-otp', payload);
    return response.data;
  },

  resendOtp: async (payload) => {
    const response = await api.post('/auth/resend-otp', payload);
    return response.data;
  },

  setupPassword: async (payload) => {
    const response = await api.post('/auth/setup-password', payload);
    return response.data;
  },
};

export const napsAPI = {
  getAll: async (params = {}) => {
    const response = await api.get('/naps', { params });
    return response.data;
  },

  getNearest: async (params = {}) => {
    const response = await api.get('/naps/nearest', { params });
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

  search: async (params = {}) => {
    const response = await api.get('/naps/search', { params });
    return response.data;
  },
};

export const SERVER_URL = API_BASE_URL.replace('/api', '');
export default api;
