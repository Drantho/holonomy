import { afterEach, describe, expect, it } from "vitest";
import { act, ageRoom, createRoom, forgetSeen, joinRoom, readRoom, ROOM_TTL_MS } from "./rooms";

const savedDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

afterEach(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

describe("room presence", () => {
  it("lands a move while heartbeats are arriving", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const joined = await joinRoom(created.code, "Bea");
    if (!joined.ok) throw new Error(joined.error);
    const before = joined.state.version;
    const flood = Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.all([
          act(created.code, created.token, "heartbeat", {}),
          act(created.code, joined.token, "heartbeat", {}),
        ]),
      ),
    );
    const colored = await act(created.code, created.token, "color", { color: "cyan" });
    const beats = await flood;
    expect(beats.flat().every((result) => result.ok)).toBe(true);
    expect(colored.ok).toBe(true);
    const room = await readRoom(created.code, created.token);
    expect(room?.state.seats.find((seat) => seat.id === 0)?.color).toBe("cyan");
    expect(room?.state.version).toBe(before + 1);
  });

  it("keeps the lock-in version still while heartbeats land", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const before = created.state.version;
    const beat = await act(created.code, created.token, "heartbeat", {});
    expect(beat.ok).toBe(true);
    if (!beat.ok) return;
    expect(beat.state.version).toBe(before);
  });

  it("keeps the lobby after Leave so the same link can be used again", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const left = await act(created.code, created.token, "leave", { confirm: true });
    expect(left.ok).toBe(true);
    const waiting = await readRoom(created.code);
    expect(waiting?.state.phase).toBe("lobby");
    expect(waiting?.state.seats).toEqual([]);
    const rejoined = await joinRoom(created.code, "Bea");
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.state.seats.map((seat) => seat.name)).toEqual(["Bea"]);
    expect(rejoined.state.hostId).toBe(rejoined.seatId);
  });

  it("keeps the room after a player wins", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const joined = await joinRoom(created.code, "Bea");
    if (!joined.ok) throw new Error(joined.error);
    expect((await act(created.code, created.token, "color", { color: "cyan" })).ok).toBe(true);
    expect((await act(created.code, joined.token, "color", { color: "magenta" })).ok).toBe(true);
    expect((await act(created.code, created.token, "start", {})).ok).toBe(true);
    const left = await act(created.code, joined.token, "leave", { confirm: true });
    expect(left.ok).toBe(true);
    const room = await readRoom(created.code, created.token);
    expect(room?.state.phase).toBe("finished");
    expect(room?.state.result).toEqual({ kind: "win", seatId: 0 });
  });

  it("keeps a room that has no activity stamp", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    forgetSeen(created.code);
    const room = await readRoom(created.code, created.token);
    expect(room?.state.seats.map((seat) => seat.name)).toEqual(["Ada"]);
    const left = await act(created.code, created.token, "leave", { confirm: true });
    expect(left.ok).toBe(true);
  });

  it("drops a room only after it has been idle past the time limit", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    ageRoom(created.code, ROOM_TTL_MS + 1000);
    expect(await readRoom(created.code, created.token)).toBeNull();
  });

  it("ignores a leave that was not confirmed from the Leave button", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const hidden = await act(created.code, created.token, "leave", {});
    expect(hidden.ok).toBe(false);
    const room = await readRoom(created.code, created.token);
    expect(room?.state.seats.map((seat) => seat.name)).toEqual(["Ada"]);
  });
});
