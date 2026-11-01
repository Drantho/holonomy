export type SeatSession = {
  token: string;
  seatId: number;
};

type LiveLock = {
  tab: string;
  at: number;
  hidden: boolean;
};

const LIVE_MS = 15_000;

function key(code: string) {
  return `pathcube:${code}`;
}

function liveKey(code: string) {
  return `pathcube:${code}:live`;
}

function parse(raw: string | null): SeatSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SeatSession;
    if (!parsed.token || typeof parsed.seatId !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function tabId(): string {
  const existing = sessionStorage.getItem("pathcube:tab");
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem("pathcube:tab", created);
  return created;
}

function readLock(code: string): LiveLock | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(liveKey(code)) ?? "") as LiveLock;
    if (!parsed || typeof parsed.tab !== "string" || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

// Another visible tab already holds this browser's saved seat.
function otherTabIsHere(code: string): boolean {
  const live = readLock(code);
  if (!live || live.tab === tabId() || live.hidden) return false;
  return Date.now() - live.at <= LIVE_MS;
}

function hiddenNow() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function loadSession(code: string): SeatSession | null {
  if (typeof window === "undefined") return null;
  // Only the tab that sat down is seated. A shared link must be able to join
  // even when this browser already saved someone else's seat.
  return parse(sessionStorage.getItem(key(code)));
}

export function savedSession(code: string): SeatSession | null {
  if (typeof window === "undefined") return null;
  if (parse(sessionStorage.getItem(key(code)))) return null;
  return parse(localStorage.getItem(key(code)));
}

export function saveSession(code: string, session: SeatSession) {
  sessionStorage.setItem(key(code), JSON.stringify(session));
  holdSession(code);
}

export function holdSession(code: string) {
  if (typeof window === "undefined") return;
  const mine = parse(sessionStorage.getItem(key(code)));
  if (!mine || otherTabIsHere(code)) return;
  localStorage.setItem(key(code), JSON.stringify(mine));
  const lock: LiveLock = { tab: tabId(), at: Date.now(), hidden: hiddenNow() };
  localStorage.setItem(liveKey(code), JSON.stringify(lock));
}

export function clearSession(code: string) {
  sessionStorage.removeItem(key(code));
  if (otherTabIsHere(code)) return;
  localStorage.removeItem(key(code));
  localStorage.removeItem(liveKey(code));
}
