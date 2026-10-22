/**
 * importLogic.ts
 *
 * Pure rules for the welcome moment and the playlist import flow: no React,
 * no network, so they can be tested on their own.
 */

// ── Backend contract (POST /import/preview, /import/jobs, GET /import/jobs/{id}) ──

export type ImportSource = 'spotify' | 'youtube' | 'apple_music' | 'jsonld' | 'text';

export type ImportTrack = {
  index: number;
  title: string;
  artists: string[];
  album?: string | null;
  duration_sec?: number | null;
  youtube_id?: string | null;
};

export type ImportPreview = {
  source: ImportSource;
  name: string;
  description?: string | null;
  cover_url?: string | null;
  owner?: string | null;
  track_count: number;
  partial: boolean;
  note?: string | null;
  tracks: ImportTrack[];
};

export type ImportRequest = { url?: string; text?: string };

export type JobStatus = 'queued' | 'matching' | 'creating' | 'done' | 'failed';
export type ItemStatus = 'pending' | 'matched' | 'not_found';

export type ImportItem = {
  index: number;
  title: string;
  artists: string[];
  status: ItemStatus;
  song?: { id: string; youtube_id: string; title: string } | null;
  confidence?: number | null;
};

export type ImportJob = {
  job_id: string;
  status: JobStatus;
  name: string;
  source: ImportSource;
  total: number;
  matched: number;
  not_found: number;
  playlist_id?: string | null;
  error?: string | null;
  items: ImportItem[];
};

// ── Paste: link or song list ─────────────────────────────────────────────────

export type InputKind = 'empty' | 'url' | 'text';

const KNOWN_HOSTS = /(^|\.)(spotify\.com|youtube\.com|youtu\.be|apple\.com)$/i;
const HOST_AND_PATH = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(\/\S*)?$/i;

/** Is what the person pasted a link, or a song list? */
export function classifyInput(raw: string): InputKind {
  const t = raw.trim();
  if (!t) return 'empty';
  if (/\s/.test(t)) return 'text';
  if (/^spotify:\S+$/i.test(t)) return 'url';
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  const m = HOST_AND_PATH.exec(t);
  if (m && (KNOWN_HOSTS.test(m[1]) || (m[2] && m[2].length > 1))) return 'url';
  return 'text';
}

/** Adds https:// to a bare link such as "open.spotify.com/playlist/...". */
export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  return /^(https?:\/\/|spotify:)/i.test(t) ? t : `https://${t}`;
}

/** The body for /import/preview and /import/jobs, or null when there is nothing to send. */
export function buildRequest(raw: string): ImportRequest | null {
  const kind = classifyInput(raw);
  if (kind === 'empty') return null;
  if (kind === 'url') return { url: normalizeUrl(raw) };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { text: lines.join('\n') };
}

/** How many songs a pasted list holds (one per non-empty line). */
export function listLineCount(raw: string): number {
  return raw.split(/\r?\n/).filter((l) => l.trim()).length;
}

export const songsLabel = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

/** "and 43 more" for the preview, or null when everything is shown. */
export function moreLabel(trackCount: number, shown: number): string | null {
  const rest = trackCount - shown;
  return rest > 0 ? `and ${rest} more` : null;
}

// ── Progress ─────────────────────────────────────────────────────────────────

const RUNNING: ReadonlySet<JobStatus> = new Set(['queued', 'matching', 'creating']);
export const isRunning = (status?: JobStatus | null) => (status ? RUNNING.has(status) : false);

/** Songs looked at so far (found or not). */
export const checkedCount = (job: Pick<ImportJob, 'matched' | 'not_found'>) => job.matched + job.not_found;

/** 0..1 for the Meend line. Holds back from 1 until the playlist actually exists. */
export function progressFraction(
  job: Pick<ImportJob, 'status' | 'total' | 'matched' | 'not_found'> | null | undefined
): number {
  if (!job) return 0;
  if (job.status === 'done') return 1;
  if (job.total <= 0) return 0;
  const f = Math.min(1, Math.max(0, checkedCount(job) / job.total));
  return job.status === 'creating' ? Math.max(f, 0.97) : Math.min(f, 0.97);
}

export const progressPercent = (job: Parameters<typeof progressFraction>[0]) =>
  Math.round(progressFraction(job) * 100);

export const itemsNotFound = (job: Pick<ImportJob, 'items'>) => job.items.filter((i) => i.status === 'not_found');

/** "Search" prefill for a song that was not found. */
export const searchQueryFor = (item: Pick<ImportItem, 'title' | 'artists'>) =>
  [item.title, ...item.artists].join(' ').replace(/\s+/g, ' ').trim();

// ── Step state machine ───────────────────────────────────────────────────────

export type Step = 'paste' | 'preview' | 'matching' | 'done';
export type Flow = { step: Step; jobId: string | null };
export type FlowEvent =
  | { type: 'previewed' }
  | { type: 'back' }
  | { type: 'started'; jobId: string }
  | { type: 'finished' }
  | { type: 'cancelled' }
  | { type: 'retry' }
  | { type: 'reset' };

export const initialFlow: Flow = { step: 'paste', jobId: null };

export function flowReducer(flow: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case 'previewed':
      return flow.step === 'paste' ? { step: 'preview', jobId: null } : flow;
    case 'back':
      return flow.step === 'preview' ? { step: 'paste', jobId: null } : flow;
    case 'started':
      return flow.step === 'preview' ? { step: 'matching', jobId: event.jobId } : flow;
    case 'finished':
      return flow.step === 'matching' ? { ...flow, step: 'done' } : flow;
    case 'cancelled':
    case 'retry':
      return flow.step === 'matching' ? { step: 'preview', jobId: null } : flow;
    case 'reset':
      return initialFlow;
  }
}

// ── Welcome ──────────────────────────────────────────────────────────────────

type UserLike =
  | {
      email?: string | null;
      user_metadata?: { full_name?: unknown; name?: unknown } | null;
    }
  | null
  | undefined;

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** First name for the greeting: from the sign-in profile, else the email before the @. */
export function firstNameFrom(user: UserLike): string {
  const meta = user?.user_metadata;
  for (const value of [meta?.full_name, meta?.name]) {
    if (typeof value === 'string' && value.trim()) return capitalise(value.trim().split(/\s+/)[0]);
  }
  const local = (user?.email ?? '').split('@')[0].trim();
  if (!local) return '';
  return capitalise(local.split(/[._+-]/)[0]);
}

/** Shown once per account, the first time an approved user reaches the app. */
export const shouldShowWelcome = (welcomedUserIds: readonly string[], userId?: string | null) =>
  Boolean(userId) && !welcomedUserIds.includes(userId as string);

/** What the backend said, or a plain line when it could not be reached. */
export function errorDetail(error: unknown): string {
  const e = error as { response?: { data?: { detail?: unknown } } } | undefined;
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (e?.response) return 'Something went wrong on our side. Try again in a moment.';
  return "Couldn't reach RagaStream. Check your connection and try again.";
}
