import Head from "next/head";
import { useState } from "react";
import MatchTable, { handOf } from "@/components/MatchTable";
import { claimStart, COLORS, createPractice, placePiece, type Match, type Stance } from "@/game";

export default function PlayPage() {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(COLORS[0].id);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");

  if (!match) {
    return (
      <>
        <Head>
          <title>Practice · Holonomy</title>
        </Head>
        <main className="menu-screen">
          <form
            className="glass menu-card"
            onSubmit={(event) => {
              event.preventDefault();
              const created = createPractice(name, color, Date.now() % 2147483647 || 1);
              if (!created.ok) {
                setError(created.error);
                return;
              }
              setMatch(created.match);
            }}
          >
            <p className="eyebrow">Practice</p>
            <h1>One player</h1>
            <p className="lede">The same cube, with nobody else in the room. Closing this page drops the run.</p>
            <label>
              Name
              <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
            </label>
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
              <a href="/">Menu</a>
            </div>
          </form>
        </main>
      </>
    );
  }

  const state = match.public;
  return (
    <>
      <Head>
        <title>Practice · Holonomy</title>
      </Head>
      <MatchTable
        state={state}
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
