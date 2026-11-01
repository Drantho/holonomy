export const BOARD_SIZE = 6;
export const PORTS_PER_FACE = 4;
export const PORT_COUNT = 24;

export type Cell = [number, number, number];
export type Vec3 = [number, number, number];

export type Stance = {
  cell: Cell;
  face: number;
  slot: number;
};

/** +x, -x, +y, -y, +z, -z. Opposite face is `face ^ 1`. */
export const NORMALS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const TANGENTS: [number, number][] = [
  [1, 2],
  [1, 2],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
];

export function oppositeFace(face: number): number {
  return face ^ 1;
}

export function portId(face: number, slot: number): number {
  return face * PORTS_PER_FACE + slot;
}

export function portFace(port: number): number {
  return Math.floor(port / PORTS_PER_FACE);
}

export function portSlot(port: number): number {
  return port % PORTS_PER_FACE;
}

export function cellKey(cell: Cell): string {
  return `${cell[0]},${cell[1]},${cell[2]}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function sameStance(a: Stance, b: Stance): boolean {
  return sameCell(a.cell, b.cell) && a.face === b.face && a.slot === b.slot;
}

export function stanceKey(stance: Stance): string {
  return `${cellKey(stance.cell)}:${stance.face}:${stance.slot}`;
}

export function onBoard(cell: Cell): boolean {
  return cell.every((value) => value >= 0 && value < BOARD_SIZE);
}

export function neighborCell(cell: Cell, face: number): Cell | null {
  const normal = NORMALS[face];
  const next: Cell = [
    cell[0] + normal[0],
    cell[1] + normal[1],
    cell[2] + normal[2],
  ];
  return onBoard(next) ? next : null;
}

export function isOuterStance(stance: Stance): boolean {
  return onBoard(stance.cell) && neighborCell(stance.cell, stance.face) === null;
}

export function cellCenter(cell: Cell): Vec3 {
  return [cell[0] - 2.5, cell[1] - 2.5, cell[2] - 2.5];
}

/** Port position relative to the center of a unit cell. Shared faces use the same slot index. */
export function portOffset(face: number, slot: number): Vec3 {
  const normal = NORMALS[face];
  const [uAxis, vAxis] = TANGENTS[face];
  const su = slot % 2 === 0 ? -0.25 : 0.25;
  const sv = slot < 2 ? -0.25 : 0.25;
  const offset: Vec3 = [0, 0, 0];
  offset[0] = normal[0] * 0.5;
  offset[1] = normal[1] * 0.5;
  offset[2] = normal[2] * 0.5;
  offset[uAxis] += su;
  offset[vAxis] += sv;
  return offset;
}

export function stancePoint(stance: Stance): Vec3 {
  const center = cellCenter(stance.cell);
  const offset = portOffset(stance.face, stance.slot);
  return [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]];
}

export function listOuterStances(): Stance[] {
  const stances: Stance[] = [];
  for (let x = 0; x < BOARD_SIZE; x += 1) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let z = 0; z < BOARD_SIZE; z += 1) {
        const cell: Cell = [x, y, z];
        for (let face = 0; face < 6; face += 1) {
          if (neighborCell(cell, face) !== null) continue;
          for (let slot = 0; slot < PORTS_PER_FACE; slot += 1) {
            stances.push({ cell, face, slot });
          }
        }
      }
    }
  }
  return stances;
}

export function internalLink(cell: Cell, a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `i:${cellKey(cell)}:${lo}-${hi}`;
}

export function seamLink(cell: Cell, face: number, slot: number): string {
  const next = neighborCell(cell, face);
  if (!next) return `o:${cellKey(cell)}:${face}:${slot}`;
  const here = cellKey(cell);
  const there = cellKey(next);
  if (here < there) return `s:${here}:${face}:${slot}`;
  return `s:${there}:${oppositeFace(face)}:${slot}`;
}

export function pathBend(a: number, b: number): { start: Vec3; mid: Vec3; end: Vec3 } {
  const start = portOffset(portFace(a), portSlot(a));
  const end = portOffset(portFace(b), portSlot(b));
  if (portFace(a) === portFace(b)) {
    const normal = NORMALS[portFace(a)];
    return {
      start,
      end,
      mid: [
        (start[0] + end[0]) / 2 - normal[0] * 0.55,
        (start[1] + end[1]) / 2 - normal[1] * 0.55,
        (start[2] + end[2]) / 2 - normal[2] * 0.55,
      ],
    };
  }
  const pull = 0.4;
  const sep = ((a * 17 + b * 31) % 7) - 3;
  const nudge = sep * 0.035;
  return {
    start,
    end,
    mid: [
      (start[0] + end[0]) * pull + nudge,
      (start[1] + end[1]) * pull + nudge * 0.4,
      (start[2] + end[2]) * pull - nudge,
    ],
  };
}

export function samplePath(a: number, b: number, steps = 8): Vec3[] {
  const { start, mid, end } = pathBend(a, b);
  const points: Vec3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push([
      u * u * start[0] + 2 * u * t * mid[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * mid[1] + t * t * end[1],
      u * u * start[2] + 2 * u * t * mid[2] + t * t * end[2],
    ]);
  }
  return points;
}
