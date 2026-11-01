export type SeatSession = {
  token: string;
  seatId: number;
};

function key(code: string) {
  return `pathcube:${code}`;
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

export function loadSession(code: string): SeatSession | null {
  if (typeof window === "undefined") return null;
  const tab = parse(sessionStorage.getItem(key(code)));
  if (tab) return tab;
  // iOS drops sessionStorage when the browser is sent to the background.
  // The same phone still has the seat in localStorage.
  const saved = parse(localStorage.getItem(key(code)));
  if (!saved) return null;
  sessionStorage.setItem(key(code), JSON.stringify(saved));
  return saved;
}

export function saveSession(code: string, session: SeatSession) {
  const raw = JSON.stringify(session);
  sessionStorage.setItem(key(code), raw);
  localStorage.setItem(key(code), raw);
}

export function clearSession(code: string) {
  sessionStorage.removeItem(key(code));
  localStorage.removeItem(key(code));
}
