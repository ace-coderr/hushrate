import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, type Route } from "../lib/store";

export function Logo({ size = 28 }: { size?: number }) {
  // Three tape cells: run (amber), curtail (cyan), hold (grey).
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="2" y="9" width="8" height="14" rx="3" fill="var(--c-run)" />
      <rect x="12" y="5" width="8" height="22" rx="3" fill="var(--c-cut)" />
      <rect x="22" y="12" width="8" height="8" rx="3" fill="var(--c-hold)" />
    </svg>
  );
}

const TABS: { to: Route; label: string }[] = [
  { to: "/desk", label: "Desk" },
  { to: "/sites", label: "Sites" },
  { to: "/whatif", label: "What-if" },
  { to: "/receipts", label: "Receipts" },
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" },
  { to: "/settings", label: "Settings" },
];

export function Nav({ route }: { route: Route }) {
  const { settings, setSettings } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [route]);
  const dark = document.documentElement.dataset.theme !== "light";
  const link = (to: Route, label: string) => (
    <a href={`#${to}`} className={route === to ? "active" : ""} aria-current={route === to ? "page" : undefined}>{label}</a>
  );
  return (
    <header className="nav">
      <div className="nav-in">
        <a className="brand" href="#/" aria-label="Hushrate home"><Logo /><span>hushrate</span></a>
        <nav className={`nav-links ${open ? "open" : ""}`} aria-label="Main">
          {link("/", "Product")}{link("/desk", "Desk")}{link("/proof", "Proof")}{link("/docs", "Docs")}
        </nav>
        <div className="nav-end">
          <button className="icon-btn" onClick={() => setSettings({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme">
            {dark ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </button>
          <a className="pill primary nav-cta" href="#/desk">Open the desk</a>
          <button className="icon-btn menu-btn" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export function TabNav({ route }: { route: Route }) {
  if (route === "/") return null;
  return (
    <div className="tabs-wrap">
      <nav className="tabs" aria-label="App sections">
        {TABS.map((t) => (
          <a key={t.to} href={`#${t.to}`} className={route === t.to ? "tab active" : "tab"} aria-current={route === t.to ? "page" : undefined}>{t.label}</a>
        ))}
      </nav>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="foot-in">
        <div className="foot-brand">
          <a className="brand" href="#/"><Logo size={24} /><span>hushrate</span></a>
          <p>Hourly run-or-curtail decisions for bitcoin mining sites, backed by receipts you can check. Testnet only: data is paid for in Ethereum Sepolia test USDC.</p>
        </div>
        <nav className="foot-links" aria-label="Footer">
          {TABS.map((t) => <a key={t.to} href={`#${t.to}`}>{t.label}</a>)}
          <a href="https://github.com/ace-coderr/hushrate" rel="noopener noreferrer">Source</a>
        </nav>
        <p className="built">
          Built by <a className="ace-pill" href="https://x.com/_ace_won" rel="noopener noreferrer" target="_blank">ace</a>
        </p>
      </div>
    </footer>
  );
}

/** Fades content in when it scrolls into view. Content stays visible without JS or with reduced motion. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${seen ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

export function PageHead({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <p className="kicker">{kicker}</p>
      <h1>{title}</h1>
      {children && <p className="lede">{children}</p>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
