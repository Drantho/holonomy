import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  asBoardSize,
  colorHex,
  composeRotation,
  previewForHand,
  TURNS,
  type Piece,
  type PlacementPreview,
  type PublicState,
  type Stance,
} from "@/game";

const BoardScene = dynamic(() => import("./BoardScene"), { ssr: false });

const TURNS_UI = [
  ["X+", TURNS.xPos],
  ["X-", TURNS.xNeg],
  ["Y+", TURNS.yPos],
  ["Y-", TURNS.yNeg],
  ["Z+", TURNS.zPos],
  ["Z-", TURNS.zNeg],
] as const;

export default function MatchTable({
  state,
  hand,
  you,
  roomCode,
  busy = false,
  notice,
  onClaim,
  onLockIn,
  onLeave,
}: {
  state: PublicState;
  hand: Piece[];
  you: number | null;
  roomCode?: string;
  busy?: boolean;
  notice?: string;
  onClaim: (stance: Stance) => void;
  onLockIn: (pieceId: string, rotation: number) => void;
  onLeave?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const selected = hand.find((piece) => piece.id === selectedId) ?? null;
  const youSeat = state.seats.find((seat) => seat.id === you) ?? null;
  const yourTurn = state.phase === "playing" && state.activeSeat === you && Boolean(youSeat?.alive);

  useEffect(() => {
    if (!hand.some((piece) => piece.id === selectedId)) {
      setSelectedId(hand[0]?.id ?? null);
      setRotation(0);
    }
  }, [hand, selectedId]);

  const preview = useMemo(() => {
    if (!yourTurn || !selected || you === null) return null;
    const result = previewForHand(state, hand, you, selected.id, rotation);
    return result.ok ? result : null;
  }, [yourTurn, selected, you, state, hand, rotation]);

  const others = namesFor(state, preview, you);
  const link = roomCode && typeof window !== "undefined" ? `${window.location.origin}/r/${roomCode}` : "";
  const showTray = Boolean(youSeat?.alive && state.phase === "playing");

  return (
    <div className={showTray ? "table has-tray" : "table"}>
      <BoardScene
        state={state}
        you={youSeat?.alive ? you : null}
        selected={youSeat?.alive ? selected : null}
        rotation={rotation}
        preview={preview}
        onClaim={onClaim}
      />
      <header className="glass hud">
        <div className="hud-head">
          <div>
            <p className="eyebrow">{state.mode === "practice" ? "Practice" : "Live room"}</p>
            <h1>{titleFor(state)}</h1>
          </div>
          {onLeave && (
            <button type="button" className="text-button" onClick={onLeave}>
              Leave
            </button>
          )}
        </div>
        {roomCode && (
          <p className="code-row">
            <span>{roomCode}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                void navigator.clipboard.writeText(link);
              }}
            >
              Copy link
            </button>
          </p>
        )}
        <div className="hud-facts">
          <ul className="roster">
            {state.seats.map((seat) => (
              <li key={seat.id} className={seat.alive ? "" : "out"}>
                <i style={{ background: colorHex(seat.color) }} />
                <span>{seat.name}</span>
                {seat.id === state.activeSeat && state.phase !== "lobby" && state.phase !== "finished" ? (
                  <em>turn</em>
                ) : null}
                {!seat.alive ? <em>out</em> : null}
              </li>
            ))}
          </ul>
          <p className="meta">{cubeLabel(asBoardSize(state.size))}</p>
          {state.phase === "playing" && <p className="meta">Pile {state.pileCount}</p>}
        </div>
        {state.phase === "starts" && state.activeSeat === you && (
          <p className="meta">Click an open exit on the outside of the cube.</p>
        )}
        {state.phase === "starts" && state.activeSeat !== you && <p className="meta">Waiting for a start exit.</p>}
        {notice && <p className="meta">{notice}</p>}
      </header>
      {showTray && (
        <section className="glass tray">
          <div className="pieces">
            {hand.map((piece, index) => (
              <button
                key={piece.id}
                type="button"
                className={piece.id === selected?.id ? "piece on" : "piece"}
                onClick={() => {
                  setSelectedId(piece.id);
                  setRotation(0);
                }}
              >
                <strong>Piece {index + 1}</strong>
                <span>{pieceLabel(piece.partner)}</span>
              </button>
            ))}
          </div>
          <div className="turns">
            {TURNS_UI.map(([label, turn]) => (
              <button
                key={label}
                type="button"
                onClick={() => setRotation((current) => composeRotation(current, turn))}
              >
                {label}
              </button>
            ))}
          </div>
          {yourTurn && preview?.youLose && (
            <p className="warn">This placement eliminates you. You can still lock it in.</p>
          )}
          {yourTurn && others && <p className="meta">{others}</p>}
          {!yourTurn && <p className="meta">Not your turn. You can study your pieces. The board will not preview them.</p>}
          <button
            type="button"
            className="lock"
            disabled={!yourTurn || !preview || busy}
            onClick={() => {
              if (selected && preview) onLockIn(selected.id, rotation);
            }}
          >
            Lock in
          </button>
        </section>
      )}
      {state.phase === "finished" && (
        <section className="glass result">
          <h2>{resultTitle(state)}</h2>
          <a href="/">Back to the menu</a>
        </section>
      )}
    </div>
  );
}

function cubeLabel(size: number) {
  return `${size}×${size}×${size}`;
}

function titleFor(state: PublicState) {
  if (state.phase === "lobby") return "Choose colors";
  if (state.phase === "starts") return "Claim a start";
  if (state.phase === "finished") return "Match over";
  const active = state.seats.find((seat) => seat.id === state.activeSeat);
  return active ? `${active.name}'s turn` : "In play";
}

function resultTitle(state: PublicState) {
  const result = state.result;
  if (!result) return "Match over";
  if (result.kind === "win") {
    const ids = result.seatIds && result.seatIds.length > 0 ? result.seatIds : [result.seatId];
    const names = ids.map((id) => state.seats.find((seat) => seat.id === id)?.name ?? "A player");
    if (names.length === 1) return `${names[0]} wins`;
    if (names.length === 2) return `${names[0]} and ${names[1]} win`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} win`;
  }
  if (result.kind === "tie") {
    const names = result.seatIds
      .map((id) => state.seats.find((seat) => seat.id === id)?.name ?? "A player")
      .join(" and ");
    return `${names} tie`;
  }
  if (result.kind === "clear") return "The cube is clear";
  if (result.kind === "loss") return "Your path left the cube";
  return "The match ended";
}

function namesFor(state: PublicState, preview: PlacementPreview | null, you: number | null) {
  if (!preview) return "";
  const names = preview.travelers
    .filter((traveler) => traveler.eliminated && traveler.seatId !== you)
    .map((traveler) => state.seats.find((seat) => seat.id === traveler.seatId)?.name ?? "A player");
  if (names.length === 0) return "";
  return `This also eliminates ${names.join(" and ")}.`;
}

export function handOf(match: { hands: Record<number, Piece[]> }, seatId: number): Piece[] {
  return match.hands[seatId] ?? [];
}

function pieceLabel(partner: number[]): string {
  const bends = partner.filter(
    (other, port) => port < other && Math.floor(port / 4) === Math.floor(other / 4),
  ).length;
  return bends > 0 ? `${bends} turn${bends === 1 ? "" : "s"}` : "through paths";
}
