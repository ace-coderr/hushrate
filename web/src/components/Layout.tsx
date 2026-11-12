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

const APP_TABS: { to: Route; label: string }[] = [
  { to: "/desk", label: "Desk" },
  { to: "/sites", label: "Sites" },
  { to: "/whatif", label: "What-if" },
  { to: "/receipts", label: "Receipts" },
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" },
  { to: "/settings", label: "Settings" },
];

const LANDING_LINKS: { to: Route; label: string }[] = [
  { to: "/", label: "Product" },
  { to: "/desk", label: "Desk" },
  { to: "/proof", label: "Proof" },
  { to: "/docs", label: "Docs" },
];

function ThemeToggle() {
  const { settings, setSettings } = useStore();
  const dark = document.documentElement.dataset.theme !== "light";
  return (
    <button className="icon-btn" onClick={() => setSettings({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme" data-theme-setting={settings.theme}>
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

/**
 * The one navigation bar, in two modes.
 *  - Landing ("/"): Product, Desk, Proof, Docs, theme toggle and the "Open the desk" button.
 *  - App pages: the seven app tabs and the theme toggle. Nothing repeats and there is no call-to-action button.
 */
export function Nav({ route }: { route: Route }) {
  const app = route !== "/";
  const [open, setOpen] = useState(false);
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => setOpen(false), [route]);
  // Keep the active tab in view when the tab strip scrolls horizontally on a narrow screen.
  useEffect(() => { activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, [route]);

  const items = app ? APP_TABS : LANDING_LINKS;
  return (
    <header className={`nav ${app ? "nav-app" : "nav-landing"}`}>
      <div className="nav-in">
        <a className="brand" href="#/" aria-label="Hushrate home"><Logo /><span className="brand-name">hushrate</span></a>
        <nav className={`nav-links ${app ? "tabs-strip" : ""} ${open ? "open" : ""}`} aria-label={app ? "App sections" : "Main"}>
          {items.map((l) => {
            const active = route === l.to;
            return (
              <a key={l.to} ref={active ? activeRef : undefined} href={`#${l.to}`} className={active ? "navlink active" : "navlink"} aria-current={active ? "page" : undefined}>{l.label}</a>
            );
          })}
        </nav>
        <div className="nav-end">
          <ThemeToggle />
          {!app && <a className="pill primary nav-cta" href="#/desk">Open the desk</a>}
          {!app && (
            <button className="icon-btn menu-btn" aria-expanded={open} aria-controls="landing-menu" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

const REPO = "https://github.com/ace-coderr/hushrate";

export function Footer() {
  return (
    <footer className="footer">
      <div className="foot-in">
        <div className="foot-grid">
          <div className="foot-brand">
            <a className="brand" href="#/"><Logo size={24} /><span className="brand-name">hushrate</span></a>
            <p>Testnet build: paid in Ethereum Sepolia test USDC.</p>
          </div>
          <nav className="foot-col" aria-label="Product">
            <h4>Product</h4>
            <a href="#/desk">Desk</a><a href="#/sites">Sites</a><a href="#/whatif">What-if</a>
          </nav>
          <nav className="foot-col" aria-label="Verify">
            <h4>Verify</h4>
            <a href="#/receipts">Receipts</a><a href="#/proof">Proof</a><a href="#/docs">Docs</a>
          </nav>
          <nav className="foot-col" aria-label="Project">
            <h4>Project</h4>
            <a href="#/settings">Settings</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
            <a href={`${REPO}/tree/main/packages/mcp`} target="_blank" rel="noopener noreferrer">MCP server</a>
          </nav>
        </div>
        <hr className="foot-rule" />
        <div className="foot-bottom">
          <p className="foot-note">Testnet only. Nothing here touches mainnet or real funds.</p>
          <p className="built">Built by <a className="ace-pill" href="https://x.com/_ace_won" rel="noopener noreferrer" target="_blank">ace</a></p>
        </div>
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
