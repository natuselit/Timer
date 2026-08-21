import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

type InstallPromptOutcome = 'accepted' | 'dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: InstallPromptOutcome;
    platform: string;
  }>;
};

export type PwaInstallStatus = 'installed' | 'available' | 'ios' | 'manual';
export type PwaInstallResult = InstallPromptOutcome | 'unavailable';

type PwaInstallContextValue = {
  status: PwaInstallStatus;
  install: () => Promise<PwaInstallResult>;
};

type PwaInstallProviderProps = {
  children: ReactNode;
};

const isStandalone = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true
  );
};

const isIosDevice = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

const fallbackContext: PwaInstallContextValue = {
  status: 'manual',
  install: async () => 'unavailable'
};

const PwaInstallContext = createContext<PwaInstallContextValue>(fallbackContext);

export function PwaInstallProvider({ children }: PwaInstallProviderProps) {
  const [isInstalled, setIsInstalled] = useState(isStandalone);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const isIos = isIosDevice();

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<PwaInstallResult> => {
    if (!installPrompt) {
      return 'unavailable';
    }

    const currentPrompt = installPrompt;
    setInstallPrompt(null);
    await currentPrompt.prompt();
    const choice = await currentPrompt.userChoice;

    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
    }

    return choice.outcome;
  }, [installPrompt]);

  const value = useMemo<PwaInstallContextValue>(() => {
    const status: PwaInstallStatus = isInstalled
      ? 'installed'
      : installPrompt
        ? 'available'
        : isIos
          ? 'ios'
          : 'manual';

    return { status, install };
  }, [install, installPrompt, isInstalled, isIos]);

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}

export const usePwaInstall = (): PwaInstallContextValue => useContext(PwaInstallContext);
