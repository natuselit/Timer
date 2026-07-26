export function AppSplash() {
  return (
    <main className="app-splash" role="status" aria-live="polite" aria-label="Завантаження">
      <div className="app-splash__brand">
        <img
          className="app-splash__logo"
          src={`${import.meta.env.BASE_URL}pwa.svg`}
          alt=""
          width="96"
          height="96"
        />
        <div className="app-splash__copy">
          <h1>Облік часу</h1>
          <p>Готуємо ваш робочий день</p>
        </div>
        <span className="app-splash__loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </main>
  );
}
