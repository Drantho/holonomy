import { PORT_COUNT, portFace, portOffset, portSlot, type Vec3 } from "./geometry";

export type Matrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function det(m: Matrix3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

function apply(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Matrix3;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

function sameMatrix(a: Matrix3, b: Matrix3): boolean {
  return a.every((value, index) => value === b[index]);
}

function vectorToPort(v: Vec3): number {
  const ax = Math.abs(v[0]);
  const ay = Math.abs(v[1]);
  const az = Math.abs(v[2]);
  let face: number;
  let u: number;
  let w: number;
  if (ax >= ay && ax >= az) {
    face = v[0] > 0 ? 0 : 1;
    u = v[1];
    w = v[2];
  } else if (ay >= az) {
    face = v[1] > 0 ? 2 : 3;
    u = v[0];
    w = v[2];
  } else {
    face = v[2] > 0 ? 4 : 5;
    u = v[0];
    w = v[1];
  }
  const su = u > 0 ? 1 : 0;
  const sv = w > 0 ? 1 : 0;
  return face * 4 + (su + sv * 2);
}

function permutations(values: number[]): number[][] {
  if (values.length === 0) return [[]];
  const out: number[][] = [];
  for (let i = 0; i < values.length; i += 1) {
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const perm of permutations(rest)) out.push([values[i], ...perm]);
  }
  return out;
}

function buildRotations(): { matrix: Matrix3; perm: number[] }[] {
  const found: { matrix: Matrix3; perm: number[] }[] = [];
  const signs = [1, -1];
  for (const perm of permutations([0, 1, 2])) {
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const sign = [sx, sy, sz];
          const matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Matrix3;
          for (let axis = 0; axis < 3; axis += 1) {
            matrix[perm[axis] * 3 + axis] = sign[axis];
          }
          if (det(matrix) !== 1) continue;
          const mapping = Array.from({ length: PORT_COUNT }, (_, port) => {
            const offset = portOffset(portFace(port), portSlot(port));
            return vectorToPort(apply(matrix, offset));
          });
          found.push({ matrix, perm: mapping });
        }
      }
    }
  }
  const identity = found.findIndex((entry) => entry.perm.every((port, index) => port === index));
  if (identity > 0) {
    const [id] = found.splice(identity, 1);
    found.unshift(id);
  }
  return found;
}

const ROTATIONS = buildRotations();

export const ROTATION_COUNT = ROTATIONS.length;

export function rotationMatrix(index: number): Matrix3 {
  return ROTATIONS[index].matrix;
}

export function rotatePort(index: number, port: number): number {
  return ROTATIONS[index].perm[port];
}

export function inverseRotation(index: number): number {
  const target = ROTATIONS[index].perm;
  return ROTATIONS.findIndex((entry) => entry.perm.every((port, from) => target[port] === from));
}

export function worldPartner(partner: number[], rotation: number, worldPort: number): number {
  const inverse = inverseRotation(rotation);
  const canonical = rotatePort(inverse, worldPort);
  return rotatePort(rotation, partner[canonical]);
}

export function composeRotation(current: number, turn: number): number {
  const matrix = multiply(rotationMatrix(turn), rotationMatrix(current));
  const index = ROTATIONS.findIndex((entry) => sameMatrix(entry.matrix, matrix));
  if (index < 0) return current;
  return index;
}

function findTurn(matrix: Matrix3): number {
  const index = ROTATIONS.findIndex((entry) => sameMatrix(entry.matrix, matrix));
  if (index < 0) throw new Error("Missing cube turn");
  return index;
}

/** World-axis quarter turns. Buttons apply `composeRotation(current, turn)`. */
export const TURNS = {
  xPos: findTurn([1, 0, 0, 0, 0, -1, 0, 1, 0]),
  xNeg: findTurn([1, 0, 0, 0, 0, 1, 0, -1, 0]),
  yPos: findTurn([0, 0, 1, 0, 1, 0, -1, 0, 0]),
  yNeg: findTurn([0, 0, -1, 0, 1, 0, 1, 0, 0]),
  zPos: findTurn([0, -1, 0, 1, 0, 0, 0, 0, 1]),
  zNeg: findTurn([0, 1, 0, -1, 0, 0, 0, 0, 1]),
};
