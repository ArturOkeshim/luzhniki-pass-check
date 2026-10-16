"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";

type PlateCheckStatus = "active" | "expired" | "future" | "none";

type PlateCheck = {
  plate: string;
  status: PlateCheckStatus;
  dateFrom: string | null;
  dateTo: string | null;
  tariffName: string | null;
  accessPeriod: string | null;
  hasFine: boolean;
};

type SearchResult = {
  found: boolean;
  items: PlateCheck[];
};

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function statusTitle(status: PlateCheckStatus): string {
  if (status === "active") return "Действующий абонемент";
  if (status === "expired") return "Абонемент закончился";
  if (status === "future") return "Абонемент ещё не начался";
  return "Абонемент не найден";
}

function resultTitle(items: PlateCheck[]): string {
  if (items.length === 1) return statusTitle(items[0].status);
  return `Найдено совпадений: ${items.length}`;
}

export default function SubscriptionChecker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          authenticated?: boolean;
          configured?: boolean;
        };
        if (!active) return;
        setAuthConfigured(payload.configured !== false);
        setAuthenticated(payload.authenticated === true);
      })
      .catch(() => {
        if (active) {
          setAuthConfigured(false);
          setAuthenticated(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | { authenticated?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.authenticated) {
        throw new Error(payload?.error || "Не удалось войти в сервис.");
      }
      setPassword("");
      setAuthenticated(true);
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось войти в сервис.",
      );
      loginRef.current?.focus();
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", cache: "no-store" }).catch(
      () => undefined,
    );
    setAuthenticated(false);
    setResult(null);
    setError("");
    setQuery("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value.replace(/[\s-]/gu, "").length < 3) {
      setResult(null);
      setError("Введите не менее трёх символов ГРН.");
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | (SearchResult & { error?: string })
        | null;
      if (response.status === 401) {
        setAuthenticated(false);
        throw new Error("Сессия завершена. Войдите снова.");
      }
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Не удалось выполнить проверку.");
      }
      setResult({ found: payload.found, items: payload.items });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить проверку.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (authenticated === null) {
    return (
      <main className="site-shell auth-shell">
        <header className="topbar">
          <Image className="brand-logo" src="/brand/luzhniki-logo.png" alt="Лужники" width={2437} height={300} priority />
          <span className="service-mark">КОНТРОЛЬ ДОСТУПА</span>
        </header>
        <div className="auth-loading" role="status">
          <span className="loader loader-dark" aria-hidden="true" />
          Проверяем доступ
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="site-shell auth-shell">
        <header className="topbar">
          <Image className="brand-logo" src="/brand/luzhniki-logo.png" alt="Лужники" width={2437} height={300} priority />
          <span className="service-mark">КОНТРОЛЬ ДОСТУПА</span>
        </header>
        <section className="auth-section" aria-labelledby="auth-title">
          <div className="auth-card">
            <p className="eyebrow">СЛУЖЕБНЫЙ ДОСТУП</p>
            <h1 id="auth-title">Вход в сервис</h1>
            <p className="lead">Введите логин и пароль службы охраны.</p>
            <form className="auth-form" onSubmit={signIn} noValidate>
              <label htmlFor="service-login">ЛОГИН</label>
              <input
                ref={loginRef}
                id="service-login"
                value={login}
                onChange={(event) => {
                  setLogin(event.target.value.slice(0, 128));
                  if (authError) setAuthError("");
                }}
                autoComplete="username"
                disabled={authLoading || !authConfigured}
                required
              />
              <label htmlFor="service-password">ПАРОЛЬ</label>
              <input
                id="service-password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value.slice(0, 256));
                  if (authError) setAuthError("");
                }}
                autoComplete="current-password"
                disabled={authLoading || !authConfigured}
                required
              />
              <button type="submit" disabled={authLoading || !authConfigured}>
                {authLoading ? <span className="loader" aria-hidden="true" /> : null}
                {authLoading ? "Входим" : "Войти"}
              </button>
              {!authConfigured ? (
                <p className="form-error" role="alert">Авторизация сервиса не настроена.</p>
              ) : authError ? (
                <p className="form-error" role="alert">{authError}</p>
              ) : null}
            </form>
          </div>
        </section>
        <footer><span>ЛУЖНИКИ</span><span>ПРОВЕРКА АБОНЕМЕНТОВ</span></footer>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <Image
          className="brand-logo"
          src="/brand/luzhniki-logo.png"
          alt="Лужники"
          width={2437}
          height={300}
          priority
        />
        <div className="topbar-actions">
          <span className="service-mark">КОНТРОЛЬ ДОСТУПА</span>
          <button className="logout-button" type="button" onClick={signOut}>ВЫЙТИ</button>
        </div>
      </header>

      <section className="checker" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow">ПАРКОВОЧНЫЕ АБОНЕМЕНТЫ</p>
          <h1 id="page-title">Проверка по ГРН</h1>
          <p className="lead">
            Введите номер полностью или не менее трёх символов.
          </p>
        </div>

        <form className="search-form" onSubmit={submit} noValidate>
          <label htmlFor="plate-search">ГРН ИЛИ ЧАСТЬ ГРН</label>
          <div className="search-row">
            <div className="plate-input-wrap">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
                <path d="m16.5 16.5 4 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                id="plate-search"
                name="plate"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value.toUpperCase().slice(0, 16));
                  if (error) setError("");
                }}
                placeholder="А000АА77"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="search"
                maxLength={16}
                aria-describedby={error ? "search-error" : undefined}
              />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? <span className="loader" aria-hidden="true" /> : null}
              {loading ? "Проверяем" : "Проверить"}
            </button>
          </div>
          {error ? (
            <p className="form-error" id="search-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>

        <div className="result-space" aria-live="polite" aria-busy={loading}>
          {result?.found ? (
            <section className="result-card result-found">
              <div className="result-heading">
                <div>
                  <p className="result-kicker">РЕЗУЛЬТАТ ПРОВЕРКИ</p>
                  <h2>{resultTitle(result.items)}</h2>
                </div>
              </div>

              <div className="subscriptions">
                {result.items.map((item, index) => (
                  <article
                    className={`subscription-row status-${item.status}${item.hasFine ? " has-fine" : ""}`}
                    key={`${item.plate}-${item.dateFrom}-${item.dateTo}-${item.tariffName}-${index}`}
                  >
                    <div className="status-line">
                      <span className="status-icon" aria-hidden="true">
                        {item.status === "active" ? "✓" : item.status === "future" ? "→" : "!"}
                      </span>
                      <strong>{statusTitle(item.status)}</strong>
                    </div>

                    {item.hasFine ? (
                      <div className="fine-alert" role="alert">
                        <span aria-hidden="true">!</span>
                        ЕСТЬ ШТРАФ В БИТРИКС
                      </div>
                    ) : null}

                    <div className="subscription-main">
                      <div className="plate-value">
                        <span>ГРН</span>
                        <strong>{item.plate}</strong>
                      </div>
                      {item.dateFrom && item.dateTo ? (
                        <dl className="date-grid">
                          <div>
                            <dt>С</dt>
                            <dd>{formatDate(item.dateFrom)}</dd>
                          </div>
                          <div>
                            <dt>ПО</dt>
                            <dd>{formatDate(item.dateTo)}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>

                    {item.tariffName && item.accessPeriod ? (
                      <dl className="tariff-grid">
                        <div>
                          <dt>ТАРИФ</dt>
                          <dd>{item.tariffName}</dd>
                        </div>
                        <div>
                          <dt>ПЕРИОД ПОСЕЩЕНИЯ</dt>
                          <dd>{item.accessPeriod}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {result && !result.found ? (
            <section className="result-card result-empty">
              <p className="result-kicker">РЕЗУЛЬТАТ ПРОВЕРКИ</p>
              <h2>ГРН не найден</h2>
            </section>
          ) : null}
        </div>
      </section>

      <footer>
        <span>ЛУЖНИКИ</span>
        <span>ПРОВЕРКА АБОНЕМЕНТОВ</span>
      </footer>
    </main>
  );
}
