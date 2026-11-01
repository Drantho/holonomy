import { neon } from "@neondatabase/serverless";
import {
  claimStart,
  createLobby,
  eliminateSeat,
  joinLobby,
  placePiece,
  setColor,
  startLive,
  type Match,
  type Piece,
  type PublicState,
  type Stance,
} from "@/game";

export type RoomData = {
  match: Match;
  tokens: Record<string, string>;
  heartbeats: Record<string, number>;
  revision?: number;
};

export type RoomView = {
  state: PublicState;
  you: number | null;
  hand: Piece[];
};

type MemoryGlobal = typeof globalThis & { __pathRooms?: Map<string, RoomData> };

const memory = ((globalThis as MemoryGlobal).__pathRooms ??= new Map());

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// Heartbeats stop while a phone is in another app. Ten minutes is long enough to
// send the room link, or step away mid-game, without the seat being removed.
const STALE_MS = 10 * 60 * 1000;

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  const sql = database();
  if (!sql) return;
  schemaReady ??= sql`CREATE TABLE IF NOT EXISTS path_rooms (
      code TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      data JSONB NOT NULL
    )`.then(() => undefined);
  await schemaReady;
}

function tokenFor(data: RoomData, seatId: number): string {
  return data.tokens[String(seatId)] ?? "";
}

export function viewRoom(data: RoomData, token?: string | null): RoomView {
  const entry = Object.entries(data.tokens).find(([, value]) => value === token);
  const you = entry ? Number(entry[0]) : null;
  const seated = you !== null && data.match.public.seats.some((seat) => seat.id === you);
  return {
    state: data.match.public,
    you: seated ? you : null,
    hand: seated && you !== null ? (data.match.hands[you] ?? []) : [],
  };
}

function sweep(data: RoomData, now = Date.now()): { data: RoomData; empty: boolean } {
  if (data.match.public.phase === "finished") return { data, empty: false };
  let match = data.match;
  const ids = match.public.seats.map((seat) => seat.id);
  for (const id of ids) {
    const beat = data.heartbeats[String(id)] ?? 0;
    if (now - beat <= STALE_MS) continue;
    const player = match.public.seats.find((seat) => seat.id === id);
    if (!player) continue;
    if (match.public.phase !== "lobby" && !player.alive) continue;
    const result = eliminateSeat(match, id);
    if (!result.ok) continue;
    match = result.match;
    if (result.empty) return { data: { ...data, match }, empty: true };
  }
  return { data: { ...data, match }, empty: false };
}

async function read(code: string): Promise<RoomData | null> {
  const sql = database();
  if (!sql) return memory.get(code) ?? null;
  await ensureSchema();
  const rows = await sql`SELECT version, data FROM path_rooms WHERE code = ${code}`;
  const row = rows[0] as { version: number; data: RoomData } | undefined;
  if (!row) return null;
  row.data.revision = Number(row.version);
  return row.data;
}

async function write(code: string, data: RoomData, expected: number | null): Promise<boolean> {
  const sql = database();
  const nextRevision = expected === null ? 1 : expected + 1;
  if (!sql) {
    const current = memory.get(code);
    const held = current?.revision ?? current?.match.public.version;
    if (expected !== null && current && held !== expected) return false;
    data.revision = nextRevision;
    memory.set(code, data);
    return true;
  }
  data.revision = nextRevision;
  await ensureSchema();
  const payload = JSON.stringify(data);
  if (expected === null) {
    await sql`INSERT INTO path_rooms (code, version, data)
      VALUES (${code}, ${nextRevision}, ${payload}::jsonb)`;
    return true;
  }
  const rows = await sql`UPDATE path_rooms
    SET version = ${nextRevision}, data = ${payload}::jsonb
    WHERE code = ${code} AND version = ${expected}
    RETURNING code`;
  return rows.length > 0;
}

async function remove(code: string) {
  const sql = database();
  if (!sql) {
    memory.delete(code);
    return;
  }
  await ensureSchema();
  await sql`DELETE FROM path_rooms WHERE code = ${code}`;
}

export function roomHeartbeats(code: string): Record<string, number> | null {
  return memory.get(code.trim().toUpperCase())?.heartbeats ?? null;
}

function makeCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => ALPHABET[value % ALPHABET.length]).join("");
}

function makeToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readRoom(code: string, token?: string | null) {
  const normalized = code.trim().toUpperCase();
  let latest: RoomData | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await read(normalized);
    if (!found) return null;
    latest = found;
    const swept = sweep(found);
    if (swept.empty) {
      await remove(normalized);
      return null;
    }
    if (swept.data.match.public.version === found.match.public.version) {
      return viewRoom(swept.data, token);
    }
    const saved = await write(normalized, swept.data, found.revision ?? found.match.public.version);
    if (saved) return viewRoom(swept.data, token);
  }
  return latest ? viewRoom(latest, token) : null;
}

async function commit(
  code: string,
  change: (data: RoomData) => { data: RoomData; empty?: boolean } | { error: string },
): Promise<{ data: RoomData; view: RoomView } | { error: string; view?: RoomView }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = await read(code);
    if (!found) return { error: "That room does not exist." };
    const before = found.revision ?? found.match.public.version;
    const result = change(structuredClone(found));
    if ("error" in result) return { error: result.error, view: viewRoom(found) };
    if (result.empty) {
      await remove(code);
      return { data: result.data, view: viewRoom(result.data) };
    }
    const swept = sweep(result.data);
    if (swept.empty) {
      await remove(code);
      return { data: swept.data, view: viewRoom(swept.data) };
    }
    const saved = await write(code, swept.data, before);
    if (saved) return { data: swept.data, view: viewRoom(swept.data) };
  }
  return { error: "The board changed. Look again, then lock in." };
}

export async function createRoom(name: string, size = 6, tokenSeatView = true) {
  let code = makeCode();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!(await read(code))) break;
    code = makeCode();
  }
  const created = createLobby(name, size);
  if (!created.ok) return created;
  const token = makeToken();
  const data: RoomData = {
    match: created.match,
    tokens: { "0": token },
    heartbeats: { "0": Date.now() },
  };
  await write(code, data, null);
  return { ok: true as const, code, token, seatId: 0, ...viewRoom(data, tokenSeatView ? token : null) };
}

export async function joinRoom(code: string, name: string) {
  const normalized = code.trim().toUpperCase();
  const token = makeToken();
  let seatId = -1;
  const result = await commit(normalized, (data) => {
    if (data.match.public.phase !== "lobby") return { error: "This match has already started." };
    const joined = joinLobby(data.match, name);
    if (!joined.ok) return { error: joined.error };
    seatId = joined.match.public.seats[joined.match.public.seats.length - 1].id;
    data.match = joined.match;
    data.tokens[String(seatId)] = token;
    data.heartbeats[String(seatId)] = Date.now();
    return { data };
  });
  if ("error" in result) return { ok: false as const, error: result.error, spectate: result.error.includes("started") };
  return { ok: true as const, code: normalized, token, seatId, ...viewRoom(result.data, token) };
}

function authed(data: RoomData, token: string) {
  const entry = Object.entries(data.tokens).find(([, value]) => value === token);
  if (!entry) return null;
  return Number(entry[0]);
}

export async function act(
  code: string,
  token: string,
  action: string,
  body: Record<string, unknown>,
) {
  const normalized = code.trim().toUpperCase();
  if (action === "heartbeat") {
    const result = await commit(normalized, (data) => {
      const seatId = authed(data, token);
      if (seatId === null) return { error: "That seat is not in this room." };
      data.heartbeats[String(seatId)] = Date.now();
      return { data };
    });
    if ("error" in result) return { ok: false as const, error: result.error };
    return { ok: true as const, ...viewRoom(result.data, token) };
  }

  const result = await commit(normalized, (data) => {
    const seatId = authed(data, token);
    if (seatId === null) return { error: "That seat is not in this room." };
    data.heartbeats[String(seatId)] = Date.now();
    if (action === "color") {
      const colored = setColor(data.match, seatId, String(body.color ?? ""));
      if (!colored.ok) return { error: colored.error };
      data.match = colored.match;
      return { data };
    }
    if (action === "start") {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      const started = startLive(data.match, seatId, seed);
      if (!started.ok) return { error: started.error };
      data.match = started.match;
      return { data };
    }
    if (action === "claim") {
      const stance: Stance = {
        cell: [Number(body.x), Number(body.y), Number(body.z)],
        face: Number(body.face),
        slot: Number(body.slot),
      };
      if (stance.cell.some((value) => !Number.isInteger(value))) return { error: "Pick an exit on the outer surface." };
      const claimed = claimStart(data.match, seatId, stance);
      if (!claimed.ok) return { error: claimed.error };
      data.match = claimed.match;
      return { data };
    }
    if (action === "place") {
      if (Number(body.version) !== data.match.public.version) {
        return { error: "The board changed. Look again, then lock in." };
      }
      const placed = placePiece(data.match, seatId, String(body.pieceId ?? ""), Number(body.rotation));
      if (!placed.ok) return { error: placed.error };
      data.match = placed.match;
      return { data };
    }
    if (action === "leave") {
      if (body.confirm !== true) return { error: "Use Leave to exit the room." };
      const left = eliminateSeat(data.match, seatId);
      if (!left.ok) return { error: left.error };
      data.match = left.match;
      delete data.heartbeats[String(seatId)];
      return { data, empty: left.empty };
    }
    return { error: "Unknown action." };
  });
  if ("error" in result) return { ok: false as const, error: result.error, ...(result.view ?? {}) };
  return { ok: true as const, ...viewRoom(result.data, token) };
}
