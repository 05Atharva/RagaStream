/**
 * React Native has crypto.getRandomValues but no crypto.subtle, so supabase-js
 * falls back to "plain" PKCE for Google sign-in (and warns "WebCrypto API is not
 * supported"). This adds the one call it needs, subtle.digest('SHA-256', …),
 * backed by expo-crypto (built into Expo Go), so the code challenge is hashed.
 * Import it before creating the Supabase client.
 */
import * as ExpoCrypto from 'expo-crypto';

type DigestAlgorithm = string | { name: string };

const g = globalThis as unknown as { crypto?: Record<string, unknown> };

if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = ExpoCrypto.getRandomValues;
}
if (!g.crypto.subtle) {
  g.crypto.subtle = {
    digest(algorithm: DigestAlgorithm, data: BufferSource): Promise<ArrayBuffer> {
      const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
      if (name !== 'SHA-256' && name !== 'SHA-384' && name !== 'SHA-512' && name !== 'SHA-1') {
        return Promise.reject(new Error(`Unsupported digest algorithm: ${name}`));
      }
      return ExpoCrypto.digest(name as ExpoCrypto.CryptoDigestAlgorithm, data);
    },
  };
}
