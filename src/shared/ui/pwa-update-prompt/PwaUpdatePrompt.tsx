import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './PwaUpdatePrompt.css';

export function PwaUpdatePrompt() {
  const [isUpdating, setIsUpdating] = useState(false);
  const {
    needRefresh: [isUpdateReady],
    updateServiceWorker
  } = useRegisterSW({ immediate: true });

  if (!isUpdateReady) {
    return null;
  }

  const applyUpdate = async () => {
    setIsUpdating(true);

    try {
      await updateServiceWorker(true);
    } catch {
      setIsUpdating(false);
    }
  };

  return (
    <aside
      className="pwa-update-prompt"
      role="status"
      aria-live="polite"
      aria-label="Оновлення застосунку готове"
    >
      <div className="pwa-update-prompt__copy">
        <strong>Оновлення готове</strong>
        <span>Оновіть, коли буде зручно.</span>
      </div>
      <button type="button" disabled={isUpdating} onClick={() => void applyUpdate()}>
        <RefreshCw aria-hidden="true" size={18} />
        {isUpdating ? 'Оновлення…' : 'Оновити'}
      </button>
    </aside>
  );
}
