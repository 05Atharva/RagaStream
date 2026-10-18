/**
 * Toast API (no UI). `Toast.show({ type, text1, text2 })` from anywhere —
 * services included. <ToastHost /> in components/ui/Toast.tsx renders it.
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';
export type ToastMessage = { id: number; type: ToastType; text1: string; text2?: string };

export const useToastStore = create<{ current: ToastMessage | null }>(() => ({ current: null }));
let counter = 0;

const Toast = {
  show({ type = 'info', text1, text2 }: { type?: ToastType; text1: string; text2?: string }) {
    useToastStore.setState({ current: { id: ++counter, type, text1, text2 } });
  },
  hide() {
    useToastStore.setState({ current: null });
  },
};

export default Toast;
