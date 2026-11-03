import { createApi } from './api';
import { getToken, handleExpiredSignIn } from './supabase';

export const api = createApi({ getToken, onUnauthorized: handleExpiredSignIn });
