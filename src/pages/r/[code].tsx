import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { clearSession, holdSession, loadSession, savedSession, saveSession, type SeatSession } from "@/client/session";
import MatchTable from "@/components/MatchTable";
import { COLORS, type Piece, type PublicState, type Stance } from "@/game";

type RoomPayload = {
  state: PublicState;
  you: number | null;
  hand: Piece[];
  error?: string;
  token?: string;
  seatId?: number;
  code?: string;
};

function keepNewer(current: RoomPayload | null, body: RoomPayload): RoomPayload {
  if (!current) return body;
  if (body.state.version < current.state.version) return current;
  // A refresh that left before this seat was saved can answer with the same
  // board and no player. Keep the seat that just joined.
  if (current.you != null && body.you == null && body.state.version === current.state.version) return current;
  return body;
}

export default function RoomPage() {
  const router = useRouter();
  const code = typeof router.query.code === "string" ? router.query.code.toUpperCase() : "";
  const [session, setSession] = useState<SeatSession | null>(null);
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [resume, setResume] = useState<{ token: string; seatId: number; name: string } | null>(null);
  const misses = useRef(0);
  const held = useRef(false);

  useEffect(() => {
    if (!code) return;
    setSession(loadSession(code));
    setReady(true);
  }, [code]);

  useEffect(() => {
    if (!code || session) {
      setResume(null);
      return;
    }
    const saved = savedSession(code);
    if (!saved) return;
    let cancel = false;
    void (async () => {
      const response = await fetch(`/api/rooms/${code}`, {
        headers: { Authorization: `Bearer ${saved.token}` },
      });
      if (!response.ok) return;
      const body = (await response.json()) as RoomPayload;
      const seat = body.state.seats.find((entry) => entry.id === body.you && entry.alive);
      if (!cancel && seat) setResume({ token: saved.token, seatId: saved.seatId, name: seat.name });
    })();
    return () => {
      cancel = true;
    };
  }, [code, session]);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const current = loadSession(code);
      const response = await fetch(`/api/rooms/${code}`, {
        headers: current ? { Authorization: `Bearer ${current.token}` } : undefined,
      });
      const body = (await response.json()) as RoomPayload;
      if (!response.ok) {
        misses.current += 1;
        // A live board stays up. The warning is only for a room we never loaded.
        if (!held.current && misses.current >= 5) {
          setError(body.error ?? "That room does not exist.");
          setPayload(null);
        }
        return;
      }
      misses.current = 0;
      const opened = !held.current;
      held.current = true;
      setPayload((current) => keepNewer(current, body));
      if (opened) setError("");
    } catch {
      misses.current += 1;
    }
  }, [code]);

  useEffect(() => {
    if (!code || !ready) return;
    void refresh();
    const poll = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(poll);
  }, [code, ready, refresh]);

  useEffect(() => {
    if (!code || !session || payload?.state.phase === "finished") return;
    // Switching apps must not write the room. A background write races a click
    // and the click is refused. Opening the page is what keeps the room alive.
    const hold = () => holdSession(code);
    hold();
    const beat = window.setInterval(hold, 4000);
    const onVisibility = () => {
      hold();
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [code, session, payload?.state.phase, refresh]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    if (!session) return false;
    setBusy(true);
    try {
      let response: Response | null = null;
      let body: RoomPayload | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          response = await fetch(`/api/rooms/${code}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, token: session.token, ...extra }),
          });
          body = (await response.json()) as RoomPayload;
        } catch {
          response = null;
          body = null;
        }
        const message = body?.error ?? "";
        if (action === "leave" && /does not exist|not in this room/.test(message)) break;
        const missed = !response || (!response.ok && /does not exist|did not answer|busy/.test(message));
        if (!missed) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
      }
      const message = body?.error ?? "";
      const alreadyOut = action === "leave" && /does not exist|not in this room/.test(message);
      if (body?.state && !alreadyOut) {
        held.current = true;
        setPayload((current) => keepNewer(current, body as RoomPayload));
      }
      if (alreadyOut || (response && response.ok)) {
        setError("");
        return true;
      }
      setError(message || "The room did not answer. Try that again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function continueSeat() {
    if (!resume) return;
    const next = { token: resume.token, seatId: resume.seatId };
    saveSession(code, next);
    setSession(next);
    setResume(null);
    void refresh();
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      let response: Response | null = null;
      let body: (RoomPayload & { spectate?: boolean }) | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          response = await fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", code, name }),
          });
          body = (await response.json()) as RoomPayload & { spectate?: boolean };
        } catch {
          response = null;
          body = null;
        }
        const message = body?.error ?? "";
        const missed = !response || (!response.ok && /does not exist|did not answer|busy/.test(message));
        if (!missed) break;
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
      }
      if (!response || !response.ok || body?.spectate || !body?.token || body.seatId == null) {
        setError(body?.error ?? "Could not join that room.");
        void refresh();
        return;
      }
      const next = { token: body.token, seatId: body.seatId };
      saveSession(code, next);
      setSession(next);
      setResume(null);
      setPayload(body);
      setError("");
    } finally {
      setBusy(false);
    }
  }

  const state = payload?.state;
  const seated = state?.seats.some((seat) => seat.id === payload?.you && seat.alive) ?? false;
  const showJoin = ready && state?.phase === "lobby" && !seated;

  return (
    <>
      <Head>
        <title>{code ? `${code} · Holonomy` : "Holonomy"}</title>
      </Head>
      {!state && (
        <main className="menu-screen">
          {error ? (
            <div className="glass missing">
              <p className="error">{error}</p>
              <a href="/">Home</a>
            </div>
          ) : (
            <div className="glass menu-card opening">
              <p className="eyebrow">{code || "Holonomy"}</p>
              <h1>Opening room</h1>
            </div>
          )}
        </main>
      )}
      {state && (
        <MatchTable
          state={state}
          hand={seated ? (payload?.hand ?? []) : []}
          you={seated ? (payload?.you ?? null) : null}
          roomCode={code}
          busy={busy}
          notice={error}
          onClaim={(stance: Stance) =>
            void post("claim", { x: stance.cell[0], y: stance.cell[1], z: stance.cell[2], face: stance.face, slot: stance.slot })
          }
          onLockIn={(pieceId, rotation) => void post("place", { pieceId, rotation, version: state.version })}
          onLeave={
            seated
              ? () => {
                  void post("leave", { confirm: true }).then((left) => {
                    if (!left) return;
                    clearSession(code);
                    setSession(null);
                    void router.push("/");
                  });
                }
              : undefined
          }
        />
      )}
      {showJoin && (
        <form className="glass lobby-card" onSubmit={join}>
          <p className="eyebrow">Join {code}</p>
          <h2>Take a seat</h2>
          {resume && (
            <button type="button" onClick={continueSeat} disabled={busy}>
              Continue as {resume.name}
            </button>
          )}
          <label>
            Name
            <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy}>
            Join
          </button>
        </form>
      )}
      {state?.phase === "lobby" && seated && (
        <LobbyPanel
          state={state}
          you={payload?.you ?? null}
          busy={busy}
          notice={error}
          onColor={(color) => void post("color", { color })}
          onStart={() => void post("start")}
        />
      )}
      {state && state.phase !== "lobby" && state.phase !== "finished" && !seated && (
        <p className="glass spectator">View only</p>
      )}
    </>
  );
}

function LobbyPanel({
  state,
  you,
  busy,
  notice,
  onColor,
  onStart,
}: {
  state: PublicState;
  you: number | null;
  busy: boolean;
  notice: string;
  onColor: (color: string) => void;
  onStart: () => void;
}) {
  const mine = state.seats.find((seat) => seat.id === you);
  const host = state.hostId === you;
  const ready = state.seats.length >= 2 && state.seats.every((seat) => seat.color);
  return (
    <section className="glass lobby-card">
      <p className="eyebrow">Lobby</p>
      <h2>Pick a glow</h2>
      <p className="meta">Each player picks a different color.</p>
      <div className="swatches">
        {COLORS.map((color) => {
          const holder = state.seats.find((seat) => seat.color === color.id && seat.id !== you);
          return (
            <button
              key={color.id}
              type="button"
              className={holder ? "taken" : mine?.color === color.id ? "on" : ""}
              disabled={Boolean(holder) || busy}
              aria-label={holder ? `${color.label}, taken by ${holder.name}` : color.label}
              onClick={() => onColor(color.id)}
            >
              <i style={{ background: color.hex, color: color.hex }} />
              {holder ? holder.name : color.label}
            </button>
          );
        })}
      </div>
      {notice && <p className="error">{notice}</p>}
      {host ? (
        <>
          {!ready && (
            <p className="meta">
              {state.seats.length < 2
                ? "Waiting for at least one more player."
                : "Every player needs a different color before the match can start."}
            </p>
          )}
          <button type="button" className="primary" disabled={!ready || busy} onClick={onStart}>
            Start match
          </button>
        </>
      ) : (
        <p className="meta">
          {ready ? "Waiting for the host to start." : "Waiting for every player to pick a different color."}
        </p>
      )}
    </section>
  );
}
