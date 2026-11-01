import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { clearSession, loadSession, saveSession, type SeatSession } from "@/client/session";
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

export default function RoomPage() {
  const router = useRouter();
  const code = typeof router.query.code === "string" ? router.query.code.toUpperCase() : "";
  const [session, setSession] = useState<SeatSession | null>(null);
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const misses = useRef(0);

  useEffect(() => {
    if (!code) return;
    setSession(loadSession(code));
    setReady(true);
  }, [code]);

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
        if (misses.current >= 5) {
          setError(body.error ?? "That room does not exist.");
          setPayload(null);
        }
        return;
      }
      misses.current = 0;
      setPayload(body);
      setError("");
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
    // pagehide also fires when a phone switches to another app. That must not
    // leave the room. A heartbeat holds the seat until the stale window expires.
    const hold = () => {
      const body = JSON.stringify({ action: "heartbeat", token: session.token });
      try {
        navigator.sendBeacon(`/api/rooms/${code}`, new Blob([body], { type: "application/json" }));
      } catch {
        // A beacon can throw when the page is already being discarded.
      }
      void fetch(`/api/rooms/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    };
    const beat = window.setInterval(hold, 4000);
    const onVisibility = () => {
      hold();
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hold);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", hold);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [code, session, payload?.state.phase, refresh]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    if (!session) return false;
    setBusy(true);
    const response = await fetch(`/api/rooms/${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: session.token, ...extra }),
    });
    const body = (await response.json()) as RoomPayload;
    setBusy(false);
    if (body.state) setPayload(body);
    if (!response.ok) {
      setError(body.error ?? "That move was rejected.");
      return false;
    }
    setError("");
    return true;
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", code, name }),
    });
    const body = (await response.json()) as RoomPayload & { spectate?: boolean; token?: string; seatId?: number };
    setBusy(false);
    if (body.spectate || !response.ok) {
      setError(body.error ?? "This match has already started.");
      void refresh();
      return;
    }
    const next = { token: body.token as string, seatId: body.seatId as number };
    saveSession(code, next);
    setSession(next);
    setPayload(body);
  }

  const state = payload?.state;
  const seated = state?.seats.some((seat) => seat.id === payload?.you && seat.alive) ?? false;
  const showJoin = ready && state?.phase === "lobby" && !seated;

  return (
    <>
      <Head>
        <title>{code ? `${code} · Holonomy` : "Holonomy"}</title>
      </Head>
      {!state && <main className="menu-screen">{error ? <p className="error">{error}</p> : <p>Opening room…</p>}</main>}
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
          {!ready && <p className="meta">Every player needs a different color before the match can start.</p>}
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
