# Shifter

Offline-first застосунок для обліку змін, тікетів, простою, заробітку, графіка й аналітики. Дані залишаються локально; серверів, акаунтів і хмарної синхронізації немає.

## Web / PWA

```bash
npm install
npm test
npm run build
npm run dev
```

GitHub Pages публікується workflow `.github/workflows/deploy-pages.yml` після push у `main`.

## Android та iOS

Capacitor використовує `appId` `com.shifter.worktime`.

```bash
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

Для Android потрібні Android Studio та сумісний JDK. Для iOS потрібен повний Xcode. Локальні сповіщення й біометрія працюють лише в нативних збірках; PWA підтримує PIN, але не гарантує фонові нагадування.

Android використовує дозволи `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` і `USE_BIOMETRIC`. iOS містить пояснення використання Face ID у `Info.plist`.

Екранний замок не шифрує IndexedDB або JSON backup. PIN і біометричні записи не експортуються.
