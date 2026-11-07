import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useEffect, useRef, useState } from "react";
import { saveSession } from "@/client/session";
import MatchTable, { handOf } from "@/components/MatchTable";
import {
  BOARD_SIZES,
  claimStart,
  COLORS,
  createPractice,
  placePiece,
  type BoardSize,
  type Match,
  type Stance,
} from "@/game";

type Mode = "practice" | "room";

export default function Home() {
  const router = useRouter();
  const modeFromUrl = useRef(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState<BoardSize>(6);
  const [code, setCode] = useState("");
  const [color, setColor] = useState<string>(COLORS[0].id);
  const [mode, setMode] = useState<Mode>("room");
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!router.isReady || modeFromUrl.current) return;
    modeFromUrl.current = true;
    if (router.query.mode === "practice") setMode("practice");
  }, [router.isReady, router.query.mode]);

  function chooseMode(next: Mode) {
    setMode(next);
    setError("");
  }

  function startPractice() {
    const created = createPractice(name, color, Date.now() % 2147483647 || 1, size);
    if (!created.ok) {
      setError(created.error);
      return;
    }
    setError("");
    setMatch(created.match);
  }

  async function createRoom() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name, size }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Could not create a room.");
      return;
    }
    saveSession(body.code, { token: body.token, seatId: body.seatId });
    void router.push(`/r/${body.code}`);
  }

  async function joinRoom() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", name, code }),
    });
    const body = await response.json();
    setBusy(false);
    const room = String(body.code ?? code).trim().toUpperCase();
    if (body.spectate) {
      void router.push(`/r/${room}`);
      return;
    }
    if (!response.ok) {
      setError(body.error ?? "Could not join that room.");
      return;
    }
    saveSession(body.code, { token: body.token, seatId: body.seatId });
    void router.push(`/r/${body.code}`);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === "practice") startPractice();
    else void createRoom();
  }

  if (match) {
    return (
      <>
        <Head>
          <title>Practice · Holonomy</title>
        </Head>
        <MatchTable
          state={match.public}
          hand={handOf(match, 0)}
          you={0}
          onClaim={(stance: Stance) => {
            const claimed = claimStart(match, 0, stance);
            if (!claimed.ok) {
              setError(claimed.error);
              return;
            }
            setError("");
            setMatch(claimed.match);
          }}
          onLockIn={(pieceId, rotation) => {
            const placed = placePiece(match, 0, pieceId, rotation);
            if (!placed.ok) {
              setError(placed.error);
              return;
            }
            setError("");
            setMatch(placed.match);
          }}
          onLeave={() => setMatch(null)}
          notice={error}
        />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Holonomy</title>
      </Head>
      <main className="menu-screen">
        <form className="glass menu-card" onSubmit={onSubmit}>
          <p className="eyebrow">Holonomy</p>
          <h1>Find a way through.</h1>
          <p className="lede">A cube of paths for one player, or a room for two to six.</p>
          <div className="mode" role="group" aria-label="How to play">
            <button type="button" className={mode === "practice" ? "on" : ""} onClick={() => chooseMode("practice")}>
              Practice
            </button>
            <button type="button" className={mode === "room" ? "on" : ""} onClick={() => chooseMode("room")}>
              Multiplayer
            </button>
          </div>
          <label>
            Name
            <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="sizes" role="group" aria-label="Play area">
            {BOARD_SIZES.map((edge) => (
              <button
                key={edge}
                type="button"
                className={size === edge ? "on" : ""}
                onClick={() => setSize(edge)}
              >
                {edge}×{edge}×{edge}
              </button>
            ))}
          </div>
          <div key={mode} className="mode-panel">
            {mode === "practice" ? (
              <>
                <div className="swatches">
                  {COLORS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={color === entry.id ? "on" : ""}
                      onClick={() => setColor(entry.id)}
                    >
                      <i style={{ background: entry.hex, color: entry.hex }} />
                      {entry.label}
                    </button>
                  ))}
                </div>
                {error && <p className="error">{error}</p>}
                <div className="actions">
                  <button type="submit" className="primary">
                    Start
                  </button>
                </div>
              </>
            ) : (
              <>
                {error && <p className="error">{error}</p>}
                <div className="actions">
                  <button type="submit" className="primary" disabled={busy}>
                    Create room
                  </button>
                </div>
                <label>
                  Room code
                  <input
                    value={code}
                    maxLength={8}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                  />
                </label>
                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => void joinRoom()}>
                    Join room
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
      </main>
    </>
  );
}
