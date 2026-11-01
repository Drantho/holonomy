import { describe, expect, it } from "vitest";
import {
  cellCenter,
  claimStart,
  colorHex,
  COLORS,
  createLobby,
  createPractice,
  joinLobby,
  placePiece,
  portId,
  portOffset,
  resolvePlacement,
  ROTATION_COUNT,
  rotationMatrix,
  setColor,
  startLive,
  TURNS,
  composeRotation,
  type Match,
  type Piece,
  type PublicState,
  type Stance,
} from "./index";
import { pairingWith } from "./pieces";
import { oppositeFace } from "./geometry";

function piece(id: string, pairs: [number, number][]): Piece {
  return { id, partner: pairingWith(pairs) };
}

function stance(cell: [number, number, number], face: number, slot: number): Stance {
  return { cell, face, slot };
}

function seat(
  id: number,
  stanceValue: Stance | null,
  extras: Partial<Match["public"]["seats"][number]> = {},
) {
  return {
    id,
    name: `P${id}`,
    color: COLORS[id].id,
    alive: true,
    stance: stanceValue,
    trail: [],
    owed: 0,
    handCount: 1,
    ...extras,
  };
}

function state(seats: Match["public"]["seats"], board: PublicState["board"] = {}): PublicState {
  return {
    mode: "live",
    phase: "playing",
    seats,
    board,
    pileCount: 0,
    debtOrder: [],
    activeSeat: seats[0]?.id ?? null,
    hostId: 0,
    version: 1,
    result: null,
    size: 6,
  };
}

function matchFrom(
  seats: Match["public"]["seats"],
  hands: Record<number, Piece[]>,
  extras: Partial<Match> & { mode?: "live" | "practice"; pile?: Piece[] } = {},
): Match {
  const publicState = state(seats);
  publicState.mode = extras.mode ?? "live";
  publicState.pileCount = extras.pile?.length ?? 0;
  publicState.debtOrder = extras.public?.debtOrder ?? [];
  for (const entry of publicState.seats) {
    entry.owed = extras.public?.seats.find((seat) => seat.id === entry.id)?.owed ?? entry.owed;
    entry.handCount = hands[entry.id]?.length ?? 0;
  }
  if (extras.public?.debtOrder) publicState.debtOrder = extras.public.debtOrder;
  return {
    public: publicState,
    hands,
    pile: extras.pile ?? [],
    undealt: [],
  };
}

describe("geometry and rotations", () => {
  it("mates neighboring faces on the same slot", () => {
    for (let slot = 0; slot < 4; slot += 1) {
      const left = portOffset(0, slot);
      const right = portOffset(1, slot);
      const leftWorld = left.map((value, axis) => value + cellCenter([0, 0, 0])[axis]);
      const rightWorld = right.map((value, axis) => value + cellCenter([1, 0, 0])[axis]);
      expect(leftWorld).toEqual(rightWorld);
    }
  });

  it("has 24 invertible cube rotations and four quarter-turns return home", () => {
    expect(ROTATION_COUNT).toBe(24);
    const seen = new Set<string>();
    for (let index = 0; index < ROTATION_COUNT; index += 1) {
      const matrix = rotationMatrix(index);
      seen.add(matrix.join(","));
      expect(Math.round(det(matrix))).toBe(1);
    }
    expect(seen.size).toBe(24);
    let turn = 0;
    for (let step = 0; step < 4; step += 1) turn = composeRotation(turn, TURNS.xPos);
    expect(turn).toBe(0);
    turn = 0;
    for (let step = 0; step < 4; step += 1) turn = composeRotation(turn, TURNS.yPos);
    expect(turn).toBe(0);
    turn = 0;
    for (let step = 0; step < 4; step += 1) turn = composeRotation(turn, TURNS.zNeg);
    expect(turn).toBe(0);
  });
});

describe("placement", () => {
  it("sends a same-face U-turn off the cube", () => {
    const entry = portId(1, 0);
    const exit = portId(1, 1);
    const played = piece("u", [[entry, exit]]);
    const publicState = state([seat(0, stance([0, 0, 0], 1, 0))]);
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.youLose).toBe(true);
    expect(preview.travelers[0]?.reason).toBe("off");
  });

  it("stops in the empty cell beyond a straight crossing", () => {
    const played = piece("cross", [[portId(1, 0), portId(0, 0)]]);
    const publicState = state([seat(0, stance([0, 0, 0], 1, 0))]);
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.youLose).toBe(false);
    expect(preview.travelers[0]?.stance).toEqual(stance([1, 0, 0], oppositeFace(0), 0));
  });

  it("drags a second player who is facing the same cell", () => {
    const played = piece("drag", [
      [portId(1, 0), portId(2, 0)],
      [portId(0, 0), portId(2, 1)],
    ]);
    const publicState = state([
      seat(0, stance([1, 0, 0], 1, 0)),
      seat(1, stance([1, 0, 0], 0, 0)),
    ]);
    publicState.activeSeat = 0;
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.travelers.every((traveler) => !traveler.eliminated)).toBe(true);
    const first = preview.travelers.find((traveler) => traveler.seatId === 0);
    const second = preview.travelers.find((traveler) => traveler.seatId === 1);
    expect(first?.stance).toEqual(stance([1, 1, 0], oppositeFace(2), 0));
    expect(second?.stance).toEqual(stance([1, 1, 0], oppositeFace(2), 1));
  });

  it("eliminates both players who share one path", () => {
    const played = piece("crash", [[portId(1, 0), portId(0, 0)]]);
    const publicState = state([
      seat(0, stance([1, 0, 0], 1, 0)),
      seat(1, stance([1, 0, 0], 0, 0)),
    ]);
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.travelers.map((traveler) => traveler.reason)).toEqual(["clash", "clash"]);
  });

  it("eliminates a player whose route repeats a port", () => {
    const below = piece("below", [[portId(2, 0), portId(2, 1)]]);
    const played = piece("loop", [[portId(3, 0), portId(3, 1)]]);
    const publicState = state([seat(0, stance([1, 1, 0], 3, 0))], {
      "1,0,0": { id: below.id, partner: below.partner, rotation: 0 },
    });
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.travelers[0]?.reason).toBe("loop");
  });
});

describe("match results", () => {
  it("starts practice on the cube the player picked", () => {
    const created = createPractice("Ada", "cyan", 7, 5);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.match.public.size).toBe(5);
    expect(created.match.undealt).toHaveLength(125);
    expect(createPractice("Ada", "cyan", 7, 2).ok).toBe(false);
  });

  it("deals three pieces after the only practice exit is claimed", () => {
    const created = createPractice("Ada", "cyan", 7);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const claimed = claimStart(created.match, 0, stance([0, 2, 2], 1, 0));
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.match.public.phase).toBe("playing");
    expect(claimed.match.hands[0]).toHaveLength(3);
    expect(claimed.match.pile).toHaveLength(213);
  });

  it("refuses to start a live room with one player", () => {
    const created = createLobby("Ada");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const colored = setColor(created.match, 0, "cyan");
    expect(colored.ok).toBe(true);
    if (!colored.ok) return;
    const started = startLive(colored.match, 0, 1);
    expect(started.ok).toBe(false);
  });

  it("returns a loss in practice and does not recycle the hand", () => {
    const doomed = piece("doom", [[portId(1, 0), portId(1, 1)]]);
    const spare = piece("spare", [[portId(0, 0), portId(2, 0)]]);
    const match = matchFrom([seat(0, stance([0, 0, 0], 1, 0))], { 0: [doomed, spare] }, {
      mode: "practice",
    });
    const placed = placePiece(match, 0, doomed.id, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.match.public.result).toEqual({ kind: "loss" });
    expect(placed.match.pile).toHaveLength(0);
    expect(placed.match.hands[0]).toHaveLength(0);
  });

  it("awards the win to the last living player", () => {
    const played = piece("last", [
      [portId(1, 0), portId(1, 1)],
      [portId(3, 0), portId(3, 1)],
    ]);
    const match = matchFrom(
      [
        seat(0, stance([0, 0, 0], 1, 0)),
        seat(1, stance([0, 0, 0], 3, 0)),
        seat(2, stance([4, 4, 4], 0, 0)),
      ],
      { 0: [played], 1: [], 2: [piece("keep", [[portId(0, 0), portId(1, 0)]])] },
    );
    const placed = placePiece(match, 0, played.id, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.match.public.result).toEqual({ kind: "win", seatId: 2 });
  });

  it("ties players eliminated by the same placement", () => {
    const played = piece("tie", [[portId(1, 0), portId(0, 0)]]);
    const match = matchFrom(
      [seat(0, stance([1, 0, 0], 1, 0)), seat(1, stance([1, 0, 0], 0, 0))],
      { 0: [played], 1: [piece("held", [[portId(2, 0), portId(3, 0)]])] },
    );
    const placed = placePiece(match, 0, played.id, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.match.public.result?.kind).toBe("tie");
    if (placed.match.public.result?.kind !== "tie") return;
    expect(placed.match.public.result.seatIds.sort()).toEqual([0, 1]);
  });

  it("pays older draw debts one at a time before the player who just moved draws", () => {
    const played = piece("safe", [
      [portId(1, 0), portId(0, 0)],
      [portId(2, 0), portId(3, 0)],
    ]);
    const returnedA = piece("back-a", [[portId(0, 1), portId(1, 1)]]);
    const returnedB = piece("back-b", [[portId(0, 2), portId(1, 2)]]);
    const match = matchFrom(
      [
        seat(0, stance([1, 0, 0], 1, 0), { owed: 0, handCount: 1 }),
        seat(1, stance([1, 0, 0], 2, 0), { owed: 0, handCount: 2 }),
        seat(2, stance([4, 4, 4], 0, 1), { owed: 1, handCount: 0 }),
      ],
      { 0: [played], 1: [returnedA, returnedB], 2: [] },
      { pile: [] },
    );
    match.public.debtOrder = [2];
    const placed = placePiece(match, 0, played.id, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.match.public.phase).toBe("playing");
    expect(placed.match.hands[2]).toHaveLength(1);
    expect(placed.match.hands[0]).toHaveLength(1);
    expect(placed.match.pile).toHaveLength(0);
    expect(placed.match.public.seats.find((entry) => entry.id === 1)?.alive).toBe(false);
  });

  it("clears a practice run when the hand and the pile are both empty", () => {
    const played = piece("final", [[portId(1, 0), portId(0, 0)]]);
    const match = matchFrom([seat(0, stance([0, 0, 0], 1, 0))], { 0: [played] }, {
      mode: "practice",
      pile: [],
    });
    const placed = placePiece(match, 0, played.id, 0);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.match.public.result).toEqual({ kind: "clear" });
  });

  it("lets a second player join and take a free color", () => {
    const created = createLobby("Ada");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const joined = joinLobby(created.match, "Bea");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const ada = setColor(joined.match, 0, "cyan");
    expect(ada.ok).toBe(true);
    if (!ada.ok) return;
    const taken = setColor(ada.match, 1, "cyan");
    expect(taken.ok).toBe(false);
    const bea = setColor(ada.match, 1, "amber");
    expect(bea.ok).toBe(true);
    if (!bea.ok) return;
    const started = startLive(bea.match, 0, 3);
    expect(started.ok).toBe(true);
    expect(colorHex("amber")).toBe("#ffc14a");
  });

  it("builds a 4×4×4 deck with one piece per cell", () => {
    const created = createLobby("Ada", 4);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.match.public.size).toBe(4);
    const joined = joinLobby(created.match, "Bea");
    if (!joined.ok) return;
    const ada = setColor(joined.match, 0, "cyan");
    if (!ada.ok) return;
    const bea = setColor(ada.match, 1, "magenta");
    if (!bea.ok) return;
    const started = startLive(bea.match, 0, 3);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.match.undealt).toHaveLength(64);
  });

  it("refuses a cube that is not 4, 5, or 6 on a side", () => {
    expect(createLobby("Ada", 7).ok).toBe(false);
    expect(createLobby("Ada", 6).ok).toBe(true);
  });

  it("falls off the far face of a 4×4×4 cube", () => {
    const played = piece("edge", [[portId(1, 0), portId(0, 0)]]);
    const publicState = state([seat(0, stance([3, 0, 0], 1, 0))]);
    publicState.size = 4;
    const preview = resolvePlacement(publicState, 0, played, 0);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.youLose).toBe(true);
  });
});

function det(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}
