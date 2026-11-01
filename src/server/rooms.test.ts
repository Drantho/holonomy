import { afterEach, describe, expect, it } from "vitest";
import { act, createRoom, joinRoom, readRoom, roomHeartbeats } from "./rooms";

const savedDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

afterEach(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

describe("room presence", () => {
  it("keeps both players' heartbeats when they arrive together", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const joined = await joinRoom(created.code, "Bea");
    if (!joined.ok) throw new Error(joined.error);
    const started = Date.now();
    for (let round = 0; round < 15; round += 1) {
      const pair = await Promise.all([
        act(created.code, created.token, "heartbeat", {}),
        act(created.code, joined.token, "heartbeat", {}),
      ]);
      expect(pair.every((result) => result.ok)).toBe(true);
    }
    const beats = roomHeartbeats(created.code);
    expect(beats?.["0"]).toBeGreaterThanOrEqual(started);
    expect(beats?.["1"]).toBeGreaterThanOrEqual(started);
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

  it("removes an empty lobby only when Leave is confirmed", async () => {
    delete process.env.DATABASE_URL;
    const created = await createRoom("Ada");
    if (!created.ok) throw new Error("room was not created");
    const left = await act(created.code, created.token, "leave", { confirm: true });
    expect(left.ok).toBe(true);
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
