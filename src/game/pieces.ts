import { PORT_COUNT } from "./geometry";

export type Piece = {
  id: string;
  partner: number[];
};

export function isMatching(partner: number[]): boolean {
  if (partner.length !== PORT_COUNT) return false;
  for (let i = 0; i < PORT_COUNT; i += 1) {
    const other = partner[i];
    if (other === i || other < 0 || other >= PORT_COUNT || partner[other] !== i) return false;
  }
  return true;
}

export function pairingWith(pairs: [number, number][]): number[] {
  const partner = Array<number>(PORT_COUNT).fill(-1);
  const used = new Set<number>();
  for (const [a, b] of pairs) {
    partner[a] = b;
    partner[b] = a;
    used.add(a);
    used.add(b);
  }
  const rest: number[] = [];
  for (let i = 0; i < PORT_COUNT; i += 1) {
    if (!used.has(i)) rest.push(i);
  }
  for (let i = 0; i < rest.length; i += 2) {
    partner[rest[i]] = rest[i + 1];
    partner[rest[i + 1]] = rest[i];
  }
  return partner;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomPartner(rng: () => number): number[] {
  const ports = Array.from({ length: PORT_COUNT }, (_, index) => index);
  for (let i = ports.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = ports[i];
    ports[i] = ports[j];
    ports[j] = swap;
  }
  const partner = Array<number>(PORT_COUNT).fill(0);
  for (let i = 0; i < PORT_COUNT; i += 2) {
    partner[ports[i]] = ports[i + 1];
    partner[ports[i + 1]] = ports[i];
  }
  return partner;
}

export function makeDeck(count: number, rng: () => number, idPrefix = "p"): Piece[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}${index}`,
    partner: randomPartner(rng),
  }));
}
