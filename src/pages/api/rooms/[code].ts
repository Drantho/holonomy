import type { NextApiRequest, NextApiResponse } from "next";
import { act, readRoom } from "@/server/rooms";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = String(req.query.code ?? "");
  if (req.method === "GET") {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const view = await readRoom(code, token);
    if (!view) return res.status(404).json({ error: "That room does not exist." });
    return res.status(200).json(view);
  }
  if (req.method === "POST") {
    const token = String(req.body?.token ?? "");
    const result = await act(code, token, String(req.body?.action ?? ""), req.body ?? {});
    if (!result.ok) {
      const status = result.error.includes("changed") ? 409 : 400;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  }
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Use GET or POST." });
}
