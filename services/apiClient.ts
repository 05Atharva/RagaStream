import axios from 'axios';
import { supabase } from './supabase';

const baseURL = process.env.EXPO_PUBLIC_API_URL;

export const apiClient = axios.create({
  baseURL,
});

apiClient.interceptors.request.use(async (config) => {
  if (!supabase) {
    return config;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    config.headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  return config;
});
