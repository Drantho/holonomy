import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  cellCenter,
  cellKey,
  colorHex,
  listOuterStances,
  samplePath,
  sameStance,
  stancePoint,
  type Piece,
  type PlacementPreview,
  type PublicState,
  type Segment,
  type Stance,
  type Vec3,
} from "@/game";
import { rotationMatrix } from "@/game/rotations";

const OUTER = listOuterStances();

function quaternionFor(rotation: number) {
  const m = rotationMatrix(rotation);
  const matrix = new THREE.Matrix4().set(
    m[0],
    m[1],
    m[2],
    0,
    m[3],
    m[4],
    m[5],
    0,
    m[6],
    m[7],
    m[8],
    0,
    0,
    0,
    0,
    1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function pairCurves(partner: number[]): Vec3[][] {
  const seen = new Set<number>();
  const curves: Vec3[][] = [];
  for (let port = 0; port < partner.length; port += 1) {
    if (seen.has(port)) continue;
    const other = partner[port];
    seen.add(port);
    seen.add(other);
    curves.push(samplePath(port, other));
  }
  return curves;
}

function Tube({
  points,
  color,
  radius,
  glow = false,
}: {
  points: Vec3[];
  color: string;
  radius: number;
  glow?: boolean;
}) {
  const signature = points.map((point) => point.map((value) => value.toFixed(3)).join(",")).join("|");
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
      false,
      "catmullrom",
      0.15,
    );
    return new THREE.TubeGeometry(curve, 10, radius, 5, false);
  }, [signature, radius, points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (glow) {
    return (
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2.4}
          toneMapped={false}
        />
      </mesh>
    );
  }
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function PieceModel({
  partner,
  rotation,
  ghost = false,
}: {
  partner: number[];
  rotation: number;
  ghost?: boolean;
}) {
  const quaternion = useMemo(() => quaternionFor(rotation), [rotation]);
  const curves = useMemo(() => pairCurves(partner), [partner]);
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.96, 0.96)),
    [],
  );
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <group quaternion={quaternion}>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={ghost ? "#f7fbff" : "#d5dbe3"} transparent opacity={ghost ? 0.55 : 0.95} />
      </lineSegments>
      {curves.map((points, index) => (
        <Tube key={index} points={points} color={ghost ? "#c5ccd6" : "#b7bec8"} radius={0.018} />
      ))}
    </group>
  );
}

function worldPoints(segment: Segment): Vec3[] {
  const local = samplePath(segment.a, segment.b);
  const origin = cellCenter(segment.cell);
  return local.map((point) => [
    point[0] + origin[0],
    point[1] + origin[1],
    point[2] + origin[2],
  ]);
}

function Lattice() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const push = (a: Vec3, b: Vec3) => positions.push(...a, ...b);
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 6; j += 1) {
        const u = i - 3;
        const v = j - 3;
        push([u, v, -3], [u, v, 3]);
        push([u, -3, v], [u, 3, v]);
        push([-3, u, v], [3, u, v]);
      }
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return buffer;
  }, []);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#3a4558" />
    </lineSegments>
  );
}

function StartMarkers({
  state,
  you,
  onClaim,
}: {
  state: PublicState;
  you: number | null;
  onClaim: (stance: Stance) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const yourTurn = state.phase === "starts" && state.activeSeat === you;
  const { gl, camera } = useThree();
  const claimRef = useRef(onClaim);
  const turnRef = useRef(yourTurn);
  const stateRef = useRef(state);
  claimRef.current = onClaim;
  turnRef.current = yourTurn;
  stateRef.current = state;

  useEffect(() => {
    const element = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const current = mesh.current;
      if (!turnRef.current || !current) return;
      const rect = element.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(current, false)[0];
      let instanceId = hit?.instanceId;
      if (instanceId === undefined) {
        const ray = raycaster.ray;
        let best = Infinity;
        let bestIndex = -1;
        const pos = new THREE.Vector3();
        const mat = new THREE.Matrix4();
        for (let index = 0; index < current.count; index += 1) {
          current.getMatrixAt(index, mat);
          pos.setFromMatrixPosition(mat);
          const distance = ray.distanceToPoint(pos);
          if (distance < best) {
            best = distance;
            bestIndex = index;
          }
        }
        if (best < 0.18) instanceId = bestIndex;
      }
      if (instanceId === undefined || instanceId < 0) return;
      const stance = OUTER[instanceId];
      const taken = stateRef.current.seats.some((seat) => seat.stance && sameStance(seat.stance, stance));
      if (!stance || taken) return;
      event.stopImmediatePropagation();
      claimRef.current(stance);
    };
    element.addEventListener("pointerdown", onPointerDown, true);
    return () => element.removeEventListener("pointerdown", onPointerDown, true);
  }, [gl, camera]);

  useLayoutEffect(() => {
    const current = mesh.current;
    if (!current) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    OUTER.forEach((stance, index) => {
      const owner = state.seats.find((seat) => seat.stance && sameStance(seat.stance, stance));
      const point = stancePoint(stance);
      dummy.position.set(point[0], point[1], point[2]);
      dummy.scale.setScalar(owner ? 1.35 : 1);
      dummy.updateMatrix();
      current.setMatrixAt(index, dummy.matrix);
      color.set(owner ? colorHex(owner.color) : yourTurn ? "#c5ceda" : "#7f8b9c");
      current.setColorAt(index, color);
    });
    current.instanceMatrix.needsUpdate = true;
    if (current.instanceColor) current.instanceColor.needsUpdate = true;
    current.computeBoundingSphere();
  }, [state, yourTurn]);

  if (state.phase !== "starts") return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, OUTER.length]}>
      <sphereGeometry args={[0.05, 10, 10]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

function BoardContents({
  state,
  you,
  selected,
  rotation,
  preview,
  onClaim,
}: {
  state: PublicState;
  you: number | null;
  selected: Piece | null;
  rotation: number;
  preview: PlacementPreview | null;
  onClaim: (stance: Stance) => void;
}) {
  const youSeat = state.seats.find((seat) => seat.id === you);
  const yourTurn = state.phase === "playing" && state.activeSeat === you && Boolean(youSeat?.alive);
  const faced = yourTurn ? youSeat?.stance : null;

  return (
    <>
      <color attach="background" args={["#07080c"]} />
      <ambientLight intensity={0.6} />
      <OrbitControls enableDamping makeDefault minDistance={5} maxDistance={18} />
      <Lattice />
      <StartMarkers state={state} you={you} onClaim={onClaim} />
      {Object.entries(state.board).map(([key, placed]) => {
        const [x, y, z] = key.split(",").map(Number) as [number, number, number];
        const center = cellCenter([x, y, z]);
        return (
          <group key={key} position={center}>
            <PieceModel partner={placed.partner} rotation={placed.rotation} />
          </group>
        );
      })}
      {state.seats.flatMap((seat) =>
        seat.trail.map((segment, index) => (
          <Tube
            key={`${seat.id}-${index}-${cellKey(segment.cell)}-${segment.a}-${segment.b}`}
            points={worldPoints(segment)}
            color={colorHex(seat.color)}
            radius={0.032}
            glow
          />
        )),
      )}
      {state.phase !== "starts" &&
        state.seats.map((seat) => {
          if (!seat.alive || !seat.stance) return null;
          const point = stancePoint(seat.stance);
          return (
            <mesh key={`peg-${seat.id}`} position={point}>
              <sphereGeometry args={[0.07, 16, 16]} />
              <meshStandardMaterial
                color={colorHex(seat.color)}
                emissive={colorHex(seat.color)}
                emissiveIntensity={2.5}
                toneMapped={false}
              />
            </mesh>
          );
        })}
      {faced && (
        <mesh position={cellCenter(faced.cell)}>
          <boxGeometry args={[1.04, 1.04, 1.04]} />
          <meshBasicMaterial color={colorHex(youSeat?.color ?? null)} wireframe transparent opacity={0.35} />
        </mesh>
      )}
      {yourTurn && selected && faced && (
        <group position={cellCenter(faced.cell)}>
          <PieceModel partner={selected.partner} rotation={rotation} ghost />
        </group>
      )}
      {!yourTurn && selected && state.phase === "playing" && youSeat?.alive && (
        <group position={[4.6, -0.2, 0]}>
          <PieceModel partner={selected.partner} rotation={rotation} />
        </group>
      )}
      {preview?.travelers.flatMap((traveler) => {
        const seat = state.seats.find((entry) => entry.id === traveler.seatId);
        return traveler.segments.map((segment, index) => (
          <Tube
            key={`preview-${traveler.seatId}-${index}`}
            points={worldPoints(segment)}
            color={colorHex(seat?.color ?? null)}
            radius={0.04}
            glow
          />
        ));
      })}
      <EffectComposer>
        <Bloom luminanceThreshold={0.9} mipmapBlur intensity={0.65} />
      </EffectComposer>
    </>
  );
}

export default function BoardScene(props: {
  state: PublicState;
  you: number | null;
  selected: Piece | null;
  rotation: number;
  preview: PlacementPreview | null;
  onClaim: (stance: Stance) => void;
}) {
  return (
    <Canvas
      className="board-canvas"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh" }}
      camera={{ position: [8.2, 6.4, 8.2], fov: 42 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
    >
      <BoardContents {...props} />
    </Canvas>
  );
}
