import {
  asBoardSize,
  isBoardSize,
  cellKey,
  internalLink,
  isOuterStance,
  neighborCell,
  oppositeFace,
  portFace,
  portId,
  portSlot,
  sameCell,
  sameStance,
  seamLink,
  stanceKey,
  type BoardSize,
  type Cell,
  type Stance,
} from "./geometry";
import { isMatching, makeDeck, mulberry32, type Piece } from "./pieces";
import { ROTATION_COUNT, worldPartner } from "./rotations";

export const DECK_SIZE = 216;

export function deckSize(size: number): number {
  const edge = asBoardSize(size);
  return edge * edge * edge;
}
export const HAND_SIZE = 3;
export const MIN_LIVE_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const COLORS = [
  { id: "cyan", label: "Cyan", hex: "#3ee0ff" },
  { id: "magenta", label: "Magenta", hex: "#ff4fd8" },
  { id: "amber", label: "Amber", hex: "#ffc14a" },
  { id: "lime", label: "Lime", hex: "#b6ff4a" },
  { id: "violet", label: "Violet", hex: "#b08cff" },
  { id: "orange", label: "Orange", hex: "#ff7a3c" },
] as const;

export type ColorId = (typeof COLORS)[number]["id"];

export function colorHex(id: string | null): string {
  return COLORS.find((color) => color.id === id)?.hex ?? "#d5dbe3";
}

export type Segment = {
  cell: Cell;
  a: number;
  b: number;
};

export type Placed = {
  id: string;
  partner: number[];
  rotation: number;
};

export type Phase = "lobby" | "starts" | "playing" | "finished";

export type Result =
  | { kind: "win"; seatId: number }
  | { kind: "tie"; seatIds: number[] }
  | { kind: "loss" }
  | { kind: "clear" }
  | { kind: "abandon" };

export type PublicSeat = {
  id: number;
  name: string;
  color: string | null;
  alive: boolean;
  stance: Stance | null;
  trail: Segment[];
  owed: number;
  handCount: number;
};

export type PublicState = {
  mode: "live" | "practice";
  phase: Phase;
  seats: PublicSeat[];
  board: Record<string, Placed>;
  pileCount: number;
  debtOrder: number[];
  activeSeat: number | null;
  hostId: number | null;
  version: number;
  result: Result | null;
  size: BoardSize;
};

export type Match = {
  public: PublicState;
  hands: Record<number, Piece[]>;
  pile: Piece[];
  undealt: Piece[];
};

export type TravelerOutcome = {
  seatId: number;
  segments: Segment[];
  eliminated: boolean;
  reason: "off" | "loop" | "clash" | null;
  stance: Stance | null;
};

export type PlacementPreview = {
  ok: true;
  cell: Cell;
  travelers: TravelerOutcome[];
  youLose: boolean;
};

export type RuleFail = { ok: false; error: string };
export type RuleMatch = { ok: true; match: Match; empty?: boolean };

function fail(error: string): RuleFail {
  return { ok: false, error };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function seat(match: Match, seatId: number): PublicSeat | undefined {
  return match.public.seats.find((entry) => entry.id === seatId);
}

function living(match: Match): PublicSeat[] {
  return match.public.seats.filter((entry) => entry.alive);
}

function syncCounts(match: Match) {
  match.public.pileCount = match.pile.length;
  for (const entry of match.public.seats) {
    entry.handCount = match.hands[entry.id]?.length ?? 0;
  }
}

function bump(match: Match) {
  match.public.version += 1;
}

function finish(match: Match, result: Result) {
  match.public.phase = "finished";
  match.public.result = result;
  match.public.activeSeat = null;
}

function validName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 16) return null;
  return trimmed;
}

function validColor(color: string): color is ColorId {
  return COLORS.some((entry) => entry.id === color);
}

export function createLobby(hostName: string, size: number = 6): RuleMatch | RuleFail {
  const name = validName(hostName);
  if (!name) return fail("Enter a name up to 16 characters.");
  if (!isBoardSize(size)) return fail("Pick a 3×3×3, 4×4×4, 5×5×5, or 6×6×6 cube.");
  const match: Match = {
    public: {
      mode: "live",
      phase: "lobby",
      seats: [
        {
          id: 0,
          name,
          color: null,
          alive: true,
          stance: null,
          trail: [],
          owed: 0,
          handCount: 0,
        },
      ],
      board: {},
      pileCount: 0,
      debtOrder: [],
      activeSeat: null,
      hostId: 0,
      version: 1,
      result: null,
      size,
    },
    hands: { 0: [] },
    pile: [],
    undealt: [],
  };
  return { ok: true, match };
}

export function createPractice(
  playerName: string,
  color: string,
  seed: number,
  size: number = 6,
): RuleMatch | RuleFail {
  const name = validName(playerName);
  if (!name) return fail("Enter a name up to 16 characters.");
  if (!validColor(color)) return fail("Pick a color.");
  if (!isBoardSize(size)) return fail("Pick a 3×3×3, 4×4×4, 5×5×5, or 6×6×6 cube.");
  const match: Match = {
    public: {
      mode: "practice",
      phase: "starts",
      seats: [
        {
          id: 0,
          name,
          color,
          alive: true,
          stance: null,
          trail: [],
          owed: 0,
          handCount: 0,
        },
      ],
      board: {},
      pileCount: 0,
      debtOrder: [],
      activeSeat: 0,
      hostId: 0,
      version: 1,
      result: null,
      size,
    },
    hands: { 0: [] },
    pile: [],
    undealt: makeDeck(deckSize(size), mulberry32(seed)),
  };
  return { ok: true, match };
}

export function joinLobby(match: Match, playerName: string): RuleMatch | RuleFail {
  if (match.public.phase !== "lobby") return fail("This match has already started.");
  if (match.public.seats.length >= MAX_PLAYERS) return fail("This room is full.");
  const name = validName(playerName);
  if (!name) return fail("Enter a name up to 16 characters.");
  const next = clone(match);
  const id = next.public.seats.reduce((max, entry) => Math.max(max, entry.id), -1) + 1;
  next.public.seats.push({
    id,
    name,
    color: null,
    alive: true,
    stance: null,
    trail: [],
    owed: 0,
    handCount: 0,
  });
  next.hands[id] = [];
  bump(next);
  return { ok: true, match: next };
}

export function setColor(match: Match, seatId: number, color: string): RuleMatch | RuleFail {
  if (match.public.phase !== "lobby") return fail("Colors lock when the match starts.");
  if (!validColor(color)) return fail("Pick a color.");
  const next = clone(match);
  const player = seat(next, seatId);
  if (!player) return fail("You are not in this room.");
  if (next.public.seats.some((entry) => entry.id !== seatId && entry.color === color)) {
    return fail("That color is taken.");
  }
  player.color = color;
  bump(next);
  return { ok: true, match: next };
}

export function startLive(match: Match, seatId: number, seed: number): RuleMatch | RuleFail {
  if (match.public.mode !== "live") return fail("Practice starts as soon as you pick an exit.");
  if (match.public.phase !== "lobby") return fail("The match has already started.");
  if (match.public.hostId !== seatId) return fail("Only the room creator can start.");
  if (match.public.seats.length < MIN_LIVE_PLAYERS) {
    return fail("A live room needs at least 2 players. Practice is the one-player game.");
  }
  if (match.public.seats.length > MAX_PLAYERS) return fail("This room is full.");
  if (match.public.seats.some((entry) => !entry.color)) {
    return fail("Every player needs a color first.");
  }
  const chosen = match.public.seats.map((entry) => entry.color);
  if (new Set(chosen).size !== chosen.length) {
    return fail("Each player needs a different color.");
  }
  const next = clone(match);
  next.undealt = makeDeck(deckSize(next.public.size), mulberry32(seed));
  next.public.phase = "starts";
  next.public.activeSeat = next.public.seats[0]?.id ?? null;
  bump(next);
  return { ok: true, match: next };
}

function allClaimed(match: Match): boolean {
  return living(match).every((entry) => entry.stance !== null);
}

function deal(match: Match) {
  const players = living(match);
  for (const player of players) {
    match.hands[player.id] = match.undealt.splice(0, HAND_SIZE);
  }
  match.pile = match.undealt;
  match.undealt = [];
  syncCounts(match);
  match.public.phase = "playing";
  match.public.activeSeat = players[0]?.id ?? null;
}

export function claimStart(match: Match, seatId: number, stance: Stance): RuleMatch | RuleFail {
  if (match.public.phase !== "starts") return fail("Start exits are not open.");
  if (match.public.activeSeat !== seatId) return fail("Wait for your turn to pick an exit.");
  const next = clone(match);
  const player = seat(next, seatId);
  if (!player?.alive) return fail("You are not in this match.");
  if (!isOuterStance(stance, asBoardSize(next.public.size)) || stance.slot < 0 || stance.slot > 3) {
    return fail("Pick an exit on the outer surface.");
  }
  if (next.public.seats.some((entry) => entry.stance && sameStance(entry.stance, stance))) {
    return fail("That exit is taken.");
  }
  player.stance = clone(stance);
  const waiting = living(next).filter((entry) => entry.stance === null);
  if (waiting.length === 0 && allClaimed(next)) {
    deal(next);
  } else {
    next.public.activeSeat = waiting[0]?.id ?? null;
  }
  bump(next);
  return { ok: true, match: next };
}

function traceTraveler(
  state: PublicState,
  placedCell: Cell,
  placed: Placed,
  start: Stance,
): { segments: Segment[]; links: string[]; eliminated: boolean; reason: "off" | "loop" | null; stance: Stance | null } {
  const segments: Segment[] = [];
  const links: string[] = [];
  const visited = new Set<string>();
  const edge = asBoardSize(state.size);
  let current = placedCell;
  let face = start.face;
  let slot = start.slot;

  for (let guard = 0; guard < 512; guard += 1) {
    const entered = `${cellKey(current)}:${face}:${slot}`;
    if (visited.has(entered)) {
      return { segments, links, eliminated: true, reason: "loop", stance: null };
    }
    visited.add(entered);
    const piece = sameCell(current, placedCell) ? placed : state.board[cellKey(current)];
    if (!piece) {
      return { segments, links, eliminated: true, reason: "off", stance: null };
    }
    const entry = portId(face, slot);
    const exit = worldPartner(piece.partner, piece.rotation, entry);
    segments.push({ cell: [current[0], current[1], current[2]], a: entry, b: exit });
    links.push(internalLink(current, entry, exit));
    const exitFace = portFace(exit);
    const exitSlot = portSlot(exit);
    links.push(seamLink(current, exitFace, exitSlot, edge));
    const next = neighborCell(current, exitFace, edge);
    if (!next) {
      return { segments, links, eliminated: true, reason: "off", stance: null };
    }
    const nextFace = oppositeFace(exitFace);
    const occupied =
      sameCell(next, placedCell) || state.board[cellKey(next)] !== undefined;
    if (!occupied) {
      return {
        segments,
        links,
        eliminated: false,
        reason: null,
        stance: { cell: next, face: nextFace, slot: exitSlot },
      };
    }
    current = next;
    face = nextFace;
    slot = exitSlot;
  }
  return { segments, links, eliminated: true, reason: "loop", stance: null };
}

export function resolvePlacement(
  state: PublicState,
  seatId: number,
  piece: Piece,
  rotation: number,
): PlacementPreview | RuleFail {
  if (state.phase !== "playing") return fail("The match is not waiting for a piece.");
  if (state.activeSeat !== seatId) return fail("It is not your turn.");
  const player = state.seats.find((entry) => entry.id === seatId);
  if (!player?.alive || !player.stance) return fail("You have no exit to play from.");
  if (!Number.isInteger(rotation) || rotation < 0 || rotation >= ROTATION_COUNT) {
    return fail("That rotation is not on the cube.");
  }
  if (!isMatching(piece.partner)) return fail("That piece is not a valid cube.");
  const placedCell = player.stance.cell;
  if (state.board[cellKey(placedCell)]) return fail("That cell is already filled.");
  const placed: Placed = { id: piece.id, partner: piece.partner, rotation };
  const movers = state.seats.filter(
    (entry) => entry.alive && entry.stance && sameCell(entry.stance.cell, placedCell),
  );
  const traced = movers.map((entry) => ({
    seatId: entry.id,
    ...traceTraveler(state, placedCell, placed, entry.stance as Stance),
  }));

  const eliminated = new Map<number, "off" | "loop" | "clash">();
  for (const traveler of traced) {
    if (traveler.eliminated && traveler.reason) eliminated.set(traveler.seatId, traveler.reason);
  }

  const users = new Map<string, number[]>();
  for (const traveler of traced) {
    for (const link of traveler.links) {
      const list = users.get(link) ?? [];
      if (!list.includes(traveler.seatId)) list.push(traveler.seatId);
      users.set(link, list);
    }
  }
  for (const ids of users.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) eliminated.set(id, "clash");
  }

  const stops = new Map<string, number[]>();
  for (const traveler of traced) {
    if (!traveler.stance || eliminated.has(traveler.seatId)) continue;
    const key = stanceKey(traveler.stance);
    const list = stops.get(key) ?? [];
    list.push(traveler.seatId);
    stops.set(key, list);
  }
  for (const ids of stops.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) eliminated.set(id, "clash");
  }

  const travelers = new Set(traced.map((entry) => entry.seatId));
  for (const entry of state.seats) {
    if (!entry.alive || !entry.stance || travelers.has(entry.id)) continue;
    const key = stanceKey(entry.stance);
    const arrivals = stops.get(key) ?? [];
    if (arrivals.length === 0) continue;
    eliminated.set(entry.id, "clash");
    for (const id of arrivals) eliminated.set(id, "clash");
  }

  const outcomes: TravelerOutcome[] = traced.map((traveler) => {
    const reason = eliminated.get(traveler.seatId) ?? null;
    return {
      seatId: traveler.seatId,
      segments: traveler.segments,
      eliminated: reason !== null,
      reason,
      stance: reason ? null : traveler.stance,
    };
  });
  for (const entry of state.seats) {
    if (!eliminated.has(entry.id) || travelers.has(entry.id)) continue;
    outcomes.push({
      seatId: entry.id,
      segments: [],
      eliminated: true,
      reason: "clash",
      stance: null,
    });
  }

  return {
    ok: true,
    cell: placedCell,
    travelers: outcomes,
    youLose: outcomes.some((entry) => entry.seatId === seatId && entry.eliminated),
  };
}

function addDebt(match: Match, seatId: number, count: number) {
  const player = seat(match, seatId);
  if (!player || count <= 0) return;
  const was = player.owed;
  player.owed += count;
  if (was === 0) match.public.debtOrder.push(seatId);
}

function settle(match: Match) {
  let guard = 0;
  while (match.pile.length > 0 && match.public.debtOrder.length > 0 && guard < 1000) {
    guard += 1;
    const id = match.public.debtOrder[0];
    const player = seat(match, id);
    if (!player || !player.alive || player.owed <= 0) {
      match.public.debtOrder.shift();
      continue;
    }
    const piece = match.pile.pop();
    if (!piece) break;
    match.hands[id] = match.hands[id] ?? [];
    match.hands[id].push(piece);
    player.owed -= 1;
    match.public.debtOrder.shift();
    if (player.owed > 0) match.public.debtOrder.push(id);
  }
  syncCounts(match);
}

function recycle(match: Match, seatIds: number[]) {
  const returned: Piece[] = [];
  for (const id of seatIds) {
    returned.push(...(match.hands[id] ?? []));
    match.hands[id] = [];
    const player = seat(match, id);
    if (!player) continue;
    player.owed = 0;
    player.handCount = 0;
  }
  match.public.debtOrder = match.public.debtOrder.filter((id) => !seatIds.includes(id));
  if (returned.length === 0) return;
  match.pile = shufflePieces(match.pile.concat(returned), match.public.version + seatIds.length);
  syncCounts(match);
}

function shufflePieces(pieces: Piece[], seed: number): Piece[] {
  const rng = mulberry32(seed);
  const next = pieces.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

function livingIds(match: Match): number[] {
  return living(match).map((entry) => entry.id);
}

function advance(match: Match, fromSeat: number) {
  const order = livingIds(match);
  if (order.length === 0) {
    finish(match, { kind: "abandon" });
    return;
  }
  let index = order.indexOf(fromSeat);
  if (index < 0) index = order.length - 1;
  for (let step = 0; step < order.length; step += 1) {
    index = (index + 1) % order.length;
    const id = order[index];
    match.public.activeSeat = id;
    settle(match);
    const hand = match.hands[id] ?? [];
    if (hand.length > 0) return;
    const player = seat(match, id);
    if (match.pile.length > 0 && player && player.owed === 0) {
      addDebt(match, id, 1);
      settle(match);
    }
    if ((match.hands[id] ?? []).length > 0) return;
    if (match.public.mode === "practice" && match.pile.length === 0) {
      finish(match, { kind: "clear" });
      return;
    }
  }
  const left = living(match);
  if (left.length === 1) finish(match, { kind: "win", seatId: left[0].id });
  else if (left.length > 1) finish(match, { kind: "tie", seatIds: left.map((entry) => entry.id) });
  else finish(match, { kind: "abandon" });
}

function concludeElimination(match: Match, eliminatedIds: number[], fromSeat: number) {
  const still = living(match);
  if (match.public.mode === "practice") {
    if (still.length === 0) {
      finish(match, { kind: "loss" });
      return;
    }
  } else if (still.length === 0) {
    finish(match, { kind: "tie", seatIds: eliminatedIds });
    return;
  } else if (still.length === 1) {
    finish(match, { kind: "win", seatId: still[0].id });
    return;
  }
  advance(match, fromSeat);
}

export function placePiece(
  match: Match,
  seatId: number,
  pieceId: string,
  rotation: number,
): RuleMatch | RuleFail {
  const hand = match.hands[seatId] ?? [];
  const piece = hand.find((entry) => entry.id === pieceId);
  if (!piece) return fail("That piece is not in your hand.");
  const preview = resolvePlacement(match.public, seatId, piece, rotation);
  if (!preview.ok) return preview;
  const next = clone(match);
  next.hands[seatId] = (next.hands[seatId] ?? []).filter((entry) => entry.id !== pieceId);
  next.public.board[cellKey(preview.cell)] = {
    id: piece.id,
    partner: piece.partner,
    rotation,
  };
  const eliminatedIds: number[] = [];
  for (const traveler of preview.travelers) {
    const player = seat(next, traveler.seatId);
    if (!player) continue;
    player.trail = player.trail.concat(traveler.segments);
    if (traveler.eliminated) {
      player.alive = false;
      player.stance = null;
      eliminatedIds.push(player.id);
    } else if (traveler.stance) {
      player.stance = traveler.stance;
    }
  }
  const practiceOver = next.public.mode === "practice" && living(next).length === 0;
  if (!practiceOver) recycle(next, eliminatedIds);
  else {
    for (const id of eliminatedIds) next.hands[id] = [];
    syncCounts(next);
  }
  const placer = seat(next, seatId);
  if (next.public.phase !== "finished" && placer?.alive) {
    settle(next);
    addDebt(next, seatId, 1);
    settle(next);
  }
  if (next.public.result === null && next.public.phase !== "finished") {
    concludeElimination(next, eliminatedIds, seatId);
  } else if (practiceOver) {
    finish(next, { kind: "loss" });
  }
  syncCounts(next);
  bump(next);
  return { ok: true, match: next };
}

export function eliminateSeat(match: Match, seatId: number): RuleMatch | RuleFail {
  const next = clone(match);
  const player = seat(next, seatId);
  if (!player) return fail("You are not in this room.");
  if (next.public.phase === "lobby") {
    next.public.seats = next.public.seats.filter((entry) => entry.id !== seatId);
    delete next.hands[seatId];
    if (next.public.hostId === seatId) {
      next.public.hostId = next.public.seats[0]?.id ?? null;
    }
    bump(next);
    return { ok: true, match: next, empty: next.public.seats.length === 0 };
  }
  if (!player.alive || next.public.phase === "finished") {
    return { ok: true, match: next };
  }
  player.alive = false;
  player.stance = null;
  const practiceOver = next.public.mode === "practice";
  if (!practiceOver) recycle(next, [seatId]);
  else next.hands[seatId] = [];
  const left = living(next);
  if (practiceOver || left.length === 0) {
    finish(next, next.public.mode === "practice" ? { kind: "loss" } : { kind: "abandon" });
  } else if (left.length === 1) {
    finish(next, { kind: "win", seatId: left[0].id });
  } else if (next.public.phase === "starts") {
    const waiting = left.filter((entry) => entry.stance === null);
    if (waiting.length === 0) deal(next);
    else if (next.public.activeSeat === seatId) next.public.activeSeat = waiting[0].id;
  } else if (next.public.phase === "playing" && next.public.activeSeat === seatId) {
    settle(next);
    advance(next, seatId);
  }
  syncCounts(next);
  bump(next);
  return { ok: true, match: next };
}

export function previewForHand(
  state: PublicState,
  hand: Piece[],
  seatId: number,
  pieceId: string,
  rotation: number,
): PlacementPreview | RuleFail {
  const piece = hand.find((entry) => entry.id === pieceId);
  if (!piece) return fail("That piece is not in your hand.");
  return resolvePlacement(state, seatId, piece, rotation);
}
