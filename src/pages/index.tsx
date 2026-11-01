import Head from "next/head";
import { useRouter } from "next/router";
import { FormEvent, useState } from "react";
import { saveSession } from "@/client/session";
import { BOARD_SIZES, type BoardSize } from "@/game";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [size, setSize] = useState<BoardSize>(6);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createRoom(event: FormEvent) {
    event.preventDefault();
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

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
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

  return (
    <>
      <Head>
        <title>Holonomy</title>
      </Head>
      <main className="menu-screen">
        <form className="glass menu-card" onSubmit={createRoom}>
          <p className="eyebrow">Holonomy</p>
          <h1>Find a way through.</h1>
          <p className="lede">
            A cube of paths. Practice alone, or open a live room for two to six players.
          </p>
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
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="primary" onClick={() => void router.push("/play")}>
              Practice
            </button>
            <button type="submit" disabled={busy}>
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
            <button type="button" disabled={busy} onClick={joinRoom}>
              Join room
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
