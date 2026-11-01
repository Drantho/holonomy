export type SeatSession = {
  token: string;
  seatId: number;
};

function key(code: string) {
  return `pathcube:${code}`;
}

export function loadSession(code: string): SeatSession | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(code));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SeatSession;
    if (!parsed.token || typeof parsed.seatId !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(code: string, session: SeatSession) {
  sessionStorage.setItem(key(code), JSON.stringify(session));
}

export function clearSession(code: string) {
  sessionStorage.removeItem(key(code));
}
