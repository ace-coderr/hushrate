export const usd = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export const num = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const shortHash = (h: string | null | undefined, a = 8, b = 6) => (!h ? "n/a" : h.length > a + b + 3 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);

export const hourLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " UTC";

export const hh = (iso: string) => new Date(iso).toISOString().slice(11, 13);

export const ago = (iso: string, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export const explorerTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const explorerAddr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;
