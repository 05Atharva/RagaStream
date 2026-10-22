/**
 * Owner approvals, as pure rules (no React, no network): the response shapes
 * from GET /owner/requests, the optimistic move between lists, time-ago text
 * and the badge count. hooks/useAccessRequests.ts and RequestsScreen use them.
 */
export type RequestDecision = 'approved' | 'rejected';
export type RequestAction = 'approve' | 'reject';

export type PendingRequest = {
  user_id: string;
  email: string | null;
  provider: string | null;
  requested_at: string;
};
export type DecidedRequest = {
  user_id: string;
  email: string | null;
  provider: string | null;
  status: RequestDecision;
  decided_at: string | null;
};
export type OwnerRequests = { pending: PendingRequest[]; recent: DecidedRequest[] };

export const RECENT_LIMIT = 20;
export const REQUESTS_POLL_MS = 60_000;

/** Move one person to the front of `recent` with the new decision. Works for a pending person or a flipped decision. */
export function applyDecision(data: OwnerRequests, userId: string, action: RequestAction, now = new Date()): OwnerRequests {
  const status: RequestDecision = action === 'approve' ? 'approved' : 'rejected';
  const fromPending = data.pending.find((p) => p.user_id === userId);
  const fromRecent = data.recent.find((r) => r.user_id === userId);
  const source = fromPending ?? fromRecent;
  if (!source) return data;
  const entry: DecidedRequest = {
    user_id: source.user_id,
    email: source.email,
    provider: source.provider,
    status,
    decided_at: now.toISOString(),
  };
  return {
    pending: data.pending.filter((p) => p.user_id !== userId),
    recent: [entry, ...data.recent.filter((r) => r.user_id !== userId)].slice(0, RECENT_LIMIT),
  };
}

export function pendingCount(data: OwnerRequests | undefined): number {
  return data?.pending.length ?? 0;
}

export function pendingSubtitle(count: number): string {
  if (count === 0) return "No one's waiting";
  return count === 1 ? '1 person waiting' : `${count} people waiting`;
}

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a short date. */
export function timeAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return 'Email';
  return provider.toLowerCase() === 'google' ? 'Google' : provider.toLowerCase() === 'email' ? 'Email' : provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** 403 detail.code === 'not_owner'. */
export function isNotOwner(error: unknown): boolean {
  const res = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)?.response;
  if (res?.status !== 403) return false;
  const detail = res.data?.detail as { code?: unknown } | undefined;
  return typeof detail === 'object' && detail !== null && detail.code === 'not_owner';
}
