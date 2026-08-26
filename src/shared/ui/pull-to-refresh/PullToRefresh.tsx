import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren
} from 'react';
import { RefreshCw } from 'lucide-react';
import { flushDiagnosticLogs, recordDiagnosticError } from '../../lib/diagnostics';
import './PullToRefresh.css';

const REFRESH_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 96;
const PULL_RESISTANCE = 0.5;
const DIRECTION_LOCK_DISTANCE = 8;
const IGNORED_TARGETS =
  'button, input, select, textarea, a, [contenteditable="true"], [role="dialog"]';

type PullToRefreshProps = PropsWithChildren<{
  onRefresh?: () => void | Promise<void>;
}>;

async function refreshPageFromServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    } catch (error) {
      recordDiagnosticError('pwa.update_failed', 'app', error);
      await flushDiagnosticLogs();
      // Reloading still refreshes locally cached content when the device is offline.
    }
  }

  window.location.reload();
}

function isIgnoredTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest(IGNORED_TARGETS) !== null;
}

export function PullToRefresh({
  children,
  onRefresh = refreshPageFromServiceWorker
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startPointRef = useRef({ x: 0, y: 0 });
  const pullDistanceRef = useRef(0);
  const isTrackingRef = useRef(false);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    const resetPull = () => {
      isTrackingRef.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (
        isRefreshingRef.current ||
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        isIgnoredTarget(event.target)
      ) {
        return;
      }

      const touch = event.touches[0];
      startPointRef.current = { x: touch.clientX, y: touch.clientY };
      isTrackingRef.current = true;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isTrackingRef.current || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - startPointRef.current.x;
      const deltaY = touch.clientY - startPointRef.current.y;

      if (
        window.scrollY > 0 ||
        deltaY <= 0 ||
        (Math.abs(deltaX) > DIRECTION_LOCK_DISTANCE &&
          Math.abs(deltaX) > Math.abs(deltaY))
      ) {
        resetPull();
        return;
      }

      if (deltaY > DIRECTION_LOCK_DISTANCE && event.cancelable) {
        event.preventDefault();
      }

      const nextDistance = Math.min(
        deltaY * PULL_RESISTANCE,
        MAX_PULL_DISTANCE
      );

      pullDistanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    };

    const handleTouchEnd = () => {
      if (!isTrackingRef.current) {
        return;
      }

      isTrackingRef.current = false;

      if (pullDistanceRef.current < REFRESH_THRESHOLD) {
        resetPull();
        return;
      }

      isRefreshingRef.current = true;
      pullDistanceRef.current = REFRESH_THRESHOLD;
      setPullDistance(REFRESH_THRESHOLD);
      setIsRefreshing(true);

      void Promise.resolve()
        .then(onRefresh)
        .catch((error) => recordDiagnosticError('pwa.update_failed', 'app', error))
        .finally(() => {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          resetPull();
        });
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', resetPull, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', resetPull);
    };
  }, [onRefresh]);

  const isReady = pullDistance >= REFRESH_THRESHOLD;
  const statusLabel = isRefreshing
    ? 'Оновлення'
    : isReady
      ? 'Відпустіть для оновлення'
      : 'Потягніть вниз для оновлення';
  const indicatorStyle = {
    '--pull-distance': `${pullDistance}px`,
    '--pull-progress': Math.min(pullDistance / REFRESH_THRESHOLD, 1),
    '--pull-rotation': `${Math.min(pullDistance / REFRESH_THRESHOLD, 1) * 180}deg`
  } as CSSProperties;

  return (
    <div className="pull-to-refresh">
      {pullDistance > 0 || isRefreshing ? (
        <div
          className={`pull-to-refresh__track${isReady ? ' pull-to-refresh__track--ready' : ''}${isRefreshing ? ' pull-to-refresh__track--refreshing' : ''}`}
          style={indicatorStyle}
          role="status"
          aria-live="polite"
          aria-label={statusLabel}
        >
          <span className="pull-to-refresh__indicator" aria-hidden="true">
            <RefreshCw size={20} strokeWidth={2.4} />
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
