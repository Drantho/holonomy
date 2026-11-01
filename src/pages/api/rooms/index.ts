import type { NextApiRequest, NextApiResponse } from "next";
import { createRoom, joinRoom } from "@/server/rooms";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  const action = String(req.body?.action ?? "create");
  if (action === "join") {
    const result = await joinRoom(String(req.body?.code ?? ""), String(req.body?.name ?? ""));
    if (!result.ok) return res.status(result.spectate ? 409 : 400).json(result);
    return res.status(200).json(result);
  }
  const rawSize = req.body?.size;
  const size = rawSize === undefined || rawSize === null || rawSize === "" ? 6 : Number(rawSize);
  const created = await createRoom(String(req.body?.name ?? ""), size);
  if (!created.ok) return res.status(400).json(created);
  return res.status(200).json(created);
}
