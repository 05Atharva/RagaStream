/**
 * Account approval, as the app sees it. The backend answers 403 with
 * detail.code 'access_pending' | 'access_rejected' to anyone the owner has
 * not approved, and GET /me/access reports the status for any signed-in user.
 * This file holds the pure rules; hooks/useAccess.ts and components/AccessGate.tsx use them.
 */
export type AccessStatus = 'pending' | 'approved' | 'rejected';
export type AccessInfo = { status: AccessStatus; email?: string | null; is_owner?: boolean };

/** What the gate shows for a signed-in user. */
export type GateView = 'loading' | 'app' | 'pending' | 'rejected' | 'unreachable';

export const ACCESS_POLL_MS = 30_000;

export function gateView(q: { data?: AccessInfo; isError: boolean }): GateView {
  if (q.data) {
    if (q.data.status === 'approved') return 'app';
    return q.data.status === 'rejected' ? 'rejected' : 'pending';
  }
  if (q.isError) return 'unreachable';
  return 'loading';
}

/** True for a 403 whose detail.code starts with `access_` (the approval gate). */
export function isAccessDenied(error: unknown): boolean {
  const res = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  if (res?.status !== 403) return false;
  const detail = res.data?.detail as { code?: unknown } | string | undefined;
  return typeof detail === 'object' && detail !== null && typeof detail.code === 'string' && detail.code.startsWith('access_');
}
