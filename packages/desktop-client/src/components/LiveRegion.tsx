import { useEffect, useSyncExternalStore } from 'react';

import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';

// One message for the page's single region. A module store rather than a
// context, so the component that mounts the region can announce too.
let currentMessage = '';
let pendingFrame: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentMessage;
}

function setMessage(message: string) {
  currentMessage = message;
  listeners.forEach(listener => listener());
}

function cancelPendingFrame() {
  if (pendingFrame !== null) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
}

function announce(message: string) {
  // Clear, then set on the next frame: screen readers only announce a
  // change, so an identical message would otherwise be skipped.
  cancelPendingFrame();
  setMessage('');
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    setMessage(message);
  });
}

export function LiveRegion() {
  const message = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(
    () => () => {
      cancelPendingFrame();
      currentMessage = '';
    },
    [],
  );

  return (
    <View
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={styles.visuallyHidden}
    >
      {message}
    </View>
  );
}

export function useAnnounce(): (message: string) => void {
  return announce;
}
