import { create } from 'zustand';
import { flowReducer, initialFlow, type Flow, type FlowEvent, type ImportPreview, type ImportRequest } from '../services/importLogic';

type ImportStore = {
  flow: Flow;
  /** What the person typed or pasted. */
  draft: string;
  /** The request the preview was made from; the job is created from the same one. */
  request: ImportRequest | null;
  preview: ImportPreview | null;
  /** The editable playlist name on the preview step. */
  name: string;
  /** True while the Import screen is on top, so a finished job only toasts when you are elsewhere. */
  screenFocused: boolean;
  /** The last job we announced, so "ready" shows once. */
  announcedJobId: string | null;

  dispatch: (event: FlowEvent) => void;
  setDraft: (draft: string) => void;
  setName: (name: string) => void;
  setPreview: (request: ImportRequest, preview: ImportPreview) => void;
  setScreenFocused: (focused: boolean) => void;
  markAnnounced: (jobId: string) => void;
  reset: () => void;
};

const blank = {
  flow: initialFlow,
  draft: '',
  request: null,
  preview: null,
  name: '',
  announcedJobId: null,
} as const;

/**
 * Where the import flow stands. Lives outside the screen so leaving it (or
 * backing out to Home) doesn't lose the job: the watcher keeps polling and
 * reopening the screen picks up at the right step. Never saved to the phone.
 */
export const useImportStore = create<ImportStore>()((set) => ({
  ...blank,
  screenFocused: false,
  dispatch: (event) => set((s) => ({ flow: flowReducer(s.flow, event) })),
  setDraft: (draft) => set({ draft }),
  setName: (name) => set({ name }),
  setPreview: (request, preview) => set((s) => ({ request, preview, name: preview.name, flow: flowReducer(s.flow, { type: 'previewed' }) })),
  setScreenFocused: (screenFocused) => set({ screenFocused }),
  markAnnounced: (announcedJobId) => set({ announcedJobId }),
  reset: () => set({ ...blank }),
}));
