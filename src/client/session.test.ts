import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSession, saveSession } from "./session";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

const local = memory();

function useTab() {
  vi.stubGlobal("sessionStorage", memory());
}

afterEach(() => {
  vi.unstubAllGlobals();
  local.clear();
});

describe("seat session", () => {
  it("lets a second tab join instead of taking the open seat", () => {
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("window", {});
    useTab();
    saveSession("ROOM1", { token: "ada", seatId: 0 });

    useTab();
    expect(loadSession("ROOM1")).toBeNull();
    saveSession("ROOM1", { token: "bea", seatId: 1 });
    expect(local.getItem("pathcube:ROOM1")).toContain("ada");
  });

  it("restores the seat when the saved tab is no longer visible", () => {
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("window", {});
    useTab();
    saveSession("ROOM1", { token: "ada", seatId: 0 });
    const lock = JSON.parse(local.getItem("pathcube:ROOM1:live") ?? "{}") as { hidden: boolean };
    lock.hidden = true;
    local.setItem("pathcube:ROOM1:live", JSON.stringify(lock));

    useTab();
    expect(loadSession("ROOM1")).toEqual({ token: "ada", seatId: 0 });
  });
});
