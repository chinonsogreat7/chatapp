import { normalizeApiOrigin } from '../api';

const DEFAULT_API_ORIGIN = 'https://chateo-lhuw.onrender.com';

export const API_ORIGIN = normalizeApiOrigin(
  process.env.EXPO_PUBLIC_API_ORIGIN ?? DEFAULT_API_ORIGIN,
);

export const API_LABEL = API_ORIGIN.replace(/^https?:\/\//, '');
