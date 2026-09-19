"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addAtom,
  atomAt,
  atomValence,
  bondAt,
  canSetOrder,
  connect,
  distance,
  elementOf,
  freeSlots,
  growthPoint,
  hydrogenCount,
  removeAtom,
  removeBond,
  setBondOrder,
  snapFrom,
  stampGroup,
  GROUP_STAMPS,
  type GroupStamp,
  type Point,
} from "@/lib/chem/edit";
import { MAX_VALENCE, type Element } from "@/lib/chem/elements";
import type { Highlight } from "@/lib/chem/explain";
import type { Guidance } from "@/lib/chem/guidance";
import { BOND_LENGTH } from "@/lib/chem/smiles";
import type { BondOrder, Molecule } from "@/lib/chem/types";
import { cn } from "@/lib/utils";

export type ViewPan = Point;

/** Pan that puts the molecule's bounding-box centre in the middle of a w×h viewport. */
export function panToCentre(mol: Molecule, width: number, height: number): ViewPan {
  if (!mol.atoms.length || width <= 0 || height <= 0) return { x: 0, y: 0 };
  const xs = mol.atoms.map((a) => a.x);
  const ys = mol.atoms.map((a) => a.y);
  return {
    x: width / 2 - (Math.max(...xs) + Math.min(...xs)) / 2,
    y: height / 2 - (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

export type Tool =
  | { kind: "bond"; order: BondOrder }
  | { kind: "atom"; element: Element }
  | { kind: "group"; stamp: GroupStamp }
  | { kind: "erase" };

const ACCENT: Record<NonNullable<Highlight["accent"]>, string> = {
  chain: "#2563eb",
  branch: "#ea580c",
  bond: "#0d9488",
  group: "#7c3aed",
};

const GUIDE_COLOR = { add: "#2563eb", ok: "#16a34a", wrong: "#dc2626" } as const;

/** Muted CPK-ish colours so heteroatoms stand out without turning into a rainbow. */
const ELEMENT_COLOR: Record<Element, string> = {
  C: "#18181b",
  O: "#c2410c",
  N: "#1d4ed8",
  F: "#15803d",
  Cl: "#15803d",
  Br: "#92400e",
  I: "#6d28d9",
};

const SUBSCRIPT = ["", "", "₂", "₃", "₄"];

type Drag = { fromId?: string; from: Point; to: Point; toId?: string; moved: boolean };
type PanDrag = { origin: Point; start: ViewPan };

type Props = {
  molecule: Molecule;
  onChange: (next: Molecule) => void;
  tool: Tool;
  highlight?: Highlight | null;
  guide?: Guidance | null;
  errorAtoms?: string[];
  showLabels?: boolean;
  readOnly?: boolean;
  /** View offset — drag the canvas (middle / right / Space+left) to pan. */
  pan?: ViewPan;
  onPanChange?: (pan: ViewPan) => void;
  className?: string;
};

export function MoleculeCanvas({
  molecule,
  onChange,
  tool,
  highlight,
  guide,
  errorAtoms,
  showLabels = false,
  readOnly = false,
  pan = { x: 0, y: 0 },
  onPanChange,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panDrag, setPanDrag] = useState<PanDrag | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setSpaceHeld(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const byId = useMemo(() => new Map(molecule.atoms.map((a) => [a.id, a])), [molecule.atoms]);
  const ghostById = useMemo(
    () => new Map((guide?.ghost?.atoms ?? []).map((a) => [a.id, a])),
    [guide],
  );
  const accent = ACCENT[highlight?.accent ?? "chain"];
  const highlightAtoms = useMemo(() => new Set(highlight?.atoms ?? []), [highlight]);
  const highlightBonds = useMemo(() => new Set(highlight?.bonds ?? []), [highlight]);
  const errorSet = useMemo(() => new Set(errorAtoms ?? []), [errorAtoms]);

  const drawnElement = tool.kind === "atom" ? tool.element : "C";
  const drawnOrder: BondOrder = tool.kind === "bond" ? tool.order : 1;

  const outward = useMemo(() => {
    const dirs = new Map<string, Point>();
    for (const atom of molecule.atoms) {
      let dx = 0;
      let dy = 0;
      for (const bond of molecule.bonds) {
        const otherId = bond.a === atom.id ? bond.b : bond.b === atom.id ? bond.a : null;
        if (!otherId) continue;
        const other = byId.get(otherId);
        if (!other) continue;
        const len = Math.hypot(other.x - atom.x, other.y - atom.y) || 1;
        dx += (other.x - atom.x) / len;
        dy += (other.y - atom.y) / len;
      }
      const len = Math.hypot(dx, dy);
      dirs.set(atom.id, len < 0.05 ? { x: 0, y: -1 } : { x: -dx / len, y: -dy / len });
    }
    return dirs;
  }, [molecule, byId]);

  const labelFor = (id: string, mol: Molecule = molecule): string | null => {
    const el = elementOf(mol, id);
    const h = hydrogenCount(mol, id);
    if (el === "C") return showLabels ? `C${h ? `H${SUBSCRIPT[h] ?? ""}` : ""}` : null;
    return `${el}${h ? `H${SUBSCRIPT[h] ?? ""}` : ""}`;
  };

  const local = (event: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - pan.x,
      y: event.clientY - rect.top - pan.y,
    };
  };

  const screen = (event: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const wantsPan = (event: React.PointerEvent) =>
    event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeld);

  const canBond = (id: string | undefined, order: BondOrder) =>
    !id || atomValence(molecule, id) + order <= MAX_VALENCE[elementOf(molecule, id)];

  const onPointerDown = (event: React.PointerEvent) => {
    if (wantsPan(event) && onPanChange) {
      event.preventDefault();
      svgRef.current?.setPointerCapture(event.pointerId);
      setPanDrag({ origin: screen(event), start: pan });
      return;
    }
    if (event.button !== 0 || readOnly) return;
    const p = local(event);
    const atom = atomAt(molecule, p);

    if (tool.kind === "erase") {
      if (atom) onChange(removeAtom(molecule, atom.id));
      else {
        const bond = bondAt(molecule, p);
        if (bond) onChange(removeBond(molecule, bond.id));
      }
      return;
    }

    if (tool.kind === "group") {
      if (atom && freeSlots(molecule, atom.id) >= GROUP_STAMPS[tool.stamp].slots) {
        onChange(stampGroup(molecule, atom.id, tool.stamp));
      }
      return;
    }

    if (atom) {
      svgRef.current?.setPointerCapture(event.pointerId);
      setDrag({
        fromId: atom.id,
        from: { x: atom.x, y: atom.y },
        to: { x: atom.x, y: atom.y },
        moved: false,
      });
      return;
    }

    const bond = bondAt(molecule, p);
    if (bond) {
      if (tool.kind !== "bond") return;
      const next = bond.order === tool.order ? 1 : tool.order;
      if (canSetOrder(molecule, bond.id, next)) onChange(setBondOrder(molecule, bond.id, next));
      return;
    }

    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ from: p, to: p, moved: false });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (panDrag && onPanChange) {
      const p = screen(event);
      onPanChange({
        x: panDrag.start.x + (p.x - panDrag.origin.x),
        y: panDrag.start.y + (p.y - panDrag.origin.y),
      });
      return;
    }
    if (readOnly) return;
    const p = local(event);
    if (!drag) {
      const atom = atomAt(molecule, p);
      setHover(atom?.id ?? null);
      return;
    }
    const moved = drag.moved || distance(p, drag.from) > 6;
    const target = molecule.atoms.find((a) => a.id !== drag.fromId && distance(a, p) <= 18);
    setDrag({
      ...drag,
      moved,
      toId: target?.id,
      to: target ? { x: target.x, y: target.y } : snapFrom(drag.from, p),
    });
  };

  const onPointerUp = () => {
    if (panDrag) {
      setPanDrag(null);
      return;
    }
    if (!drag || tool.kind === "erase" || tool.kind === "group") {
      setDrag(null);
      return;
    }
    if (!drag.moved) {
      if (drag.fromId) {
        if (canBond(drag.fromId, drawnOrder)) {
          const point = growthPoint(molecule, drag.fromId);
          onChange(
            connect(
              molecule,
              { id: drag.fromId, point: drag.from },
              { point, element: drawnElement },
              drawnOrder,
            ),
          );
        }
      } else {
        onChange(addAtom(molecule, drag.from, drawnElement).molecule);
      }
    } else if (canBond(drag.fromId, drawnOrder) && canBond(drag.toId, drawnOrder)) {
      onChange(
        connect(
          molecule,
          { id: drag.fromId, point: drag.from },
          { id: drag.toId, point: drag.to, element: drawnElement },
          drawnOrder,
        ),
      );
    }
    setDrag(null);
  };

  /** Label position for a guide marker, nudged apart when two land on the same spot. */
  const guideLabels = useMemo(() => {
    const placed: { x: number; y: number; text: string; kind: keyof typeof GUIDE_COLOR }[] = [];
    for (const marker of [...(guide?.markers ?? []), ...(guide?.errors ?? [])]) {
      const anchorAtom = marker.atoms?.map((id) => byId.get(id) ?? ghostById.get(id)).find(Boolean);
      const bondAtoms = marker.bonds?.flatMap((bondId) => {
        const bond =
          molecule.bonds.find((b) => b.id === bondId) ??
          guide?.ghost?.bonds.find((b) => b.id === bondId);
        if (!bond) return [];
        const a = byId.get(bond.a) ?? ghostById.get(bond.a);
        const b = byId.get(bond.b) ?? ghostById.get(bond.b);
        return a && b ? [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }] : [];
      });
      const base = marker.point ?? bondAtoms?.[0] ?? anchorAtom;
      if (!base) continue;
      let y = base.y - 22;
      while (placed.some((p) => Math.abs(p.x - base.x) < 120 && Math.abs(p.y - y) < 20)) y -= 22;
      placed.push({ x: base.x, y, text: marker.text, kind: marker.kind });
    }
    return placed;
  }, [guide, byId, ghostById, molecule.bonds]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <svg
        ref={svgRef}
        data-slot="molecule-canvas"
        className={cn(
          "h-full w-full touch-none select-none",
          panDrag || spaceHeld
            ? panDrag
              ? "cursor-grabbing"
              : "cursor-grab"
            : readOnly
              ? "cursor-default"
              : tool.kind === "erase" || tool.kind === "group"
                ? "cursor-pointer"
                : "cursor-crosshair",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#e4e4e7" />
          </pattern>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y})`}>
          <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#dots)" />

        {/* faint skeleton of what to draw */}
        {guide?.ghost
          ? guide.ghost.bonds.map((bond) => {
              const a = ghostById.get(bond.a);
              const b = ghostById.get(bond.b);
              if (!a || !b) return null;
              return (
                <line
                  key={`ghost-${bond.id}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#9ca3af"
                  strokeWidth={2.5}
                  strokeDasharray="7 5"
                  strokeLinecap="round"
                />
              );
            })
          : null}

        {/* guide markers */}
        {[...(guide?.markers ?? []), ...(guide?.errors ?? [])].map((marker) => {
          const color = GUIDE_COLOR[marker.kind];
          return (
            <g key={marker.id} pointerEvents="none">
              {marker.bonds?.map((bondId) => {
                const bond =
                  molecule.bonds.find((b) => b.id === bondId) ??
                  guide?.ghost?.bonds.find((b) => b.id === bondId);
                if (!bond) return null;
                const a = byId.get(bond.a) ?? ghostById.get(bond.a);
                const b = byId.get(bond.b) ?? ghostById.get(bond.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={bondId}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={14}
                    strokeLinecap="round"
                    opacity={0.2}
                  />
                );
              })}
              {marker.atoms?.map((id) => {
                // the ghost skeleton already reads as "draw this", so don't double up on it
                const atom = byId.get(id);
                if (!atom) return null;
                return (
                  <circle key={id} cx={atom.x} cy={atom.y} r={12} fill={color} opacity={0.16} />
                );
              })}
              {marker.point ? (
                <g>
                  <circle
                    cx={marker.point.x}
                    cy={marker.point.y}
                    r={12}
                    fill="#fff"
                    stroke={color}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <line
                    x1={marker.point.x - 5}
                    y1={marker.point.y}
                    x2={marker.point.x + 5}
                    y2={marker.point.y}
                    stroke={color}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                  />
                  <line
                    x1={marker.point.x}
                    y1={marker.point.y - 5}
                    x2={marker.point.x}
                    y2={marker.point.y + 5}
                    stroke={color}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                  />
                </g>
              ) : null}
            </g>
          );
        })}

        {/* breakdown highlight */}
        {molecule.bonds
          .filter((b) => highlightBonds.has(b.id))
          .map((bond) => {
            const a = byId.get(bond.a);
            const b = byId.get(bond.b);
            if (!a || !b) return null;
            return (
              <line
                key={`hl-${bond.id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={accent}
                strokeWidth={16}
                strokeLinecap="round"
                opacity={0.18}
              />
            );
          })}
        {molecule.atoms
          .filter((a) => highlightAtoms.has(a.id))
          .map((a) => (
            <circle key={`hla-${a.id}`} cx={a.x} cy={a.y} r={11} fill={accent} opacity={0.18} />
          ))}
        {molecule.atoms
          .filter((a) => errorSet.has(a.id))
          .map((a) => (
            <circle
              key={`err-${a.id}`}
              cx={a.x}
              cy={a.y}
              r={13}
              fill="none"
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          ))}

        {molecule.bonds.map((bond) => {
          const a = byId.get(bond.a);
          const b = byId.get(bond.b);
          if (!a || !b) return null;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          const trimA = labelFor(a.id) ? 14 : 0;
          const trimB = labelFor(b.id) ? 14 : 0;
          const x1 = a.x + ux * trimA;
          const y1 = a.y + uy * trimA;
          const x2 = b.x - ux * trimB;
          const y2 = b.y - uy * trimB;
          const px = -uy;
          const py = ux;
          const stroke = highlightBonds.has(bond.id) ? accent : "#18181b";
          const offsets = bond.order === 1 ? [0] : bond.order === 2 ? [-3.2, 3.2] : [-5, 0, 5];
          return (
            <g key={bond.id}>
              {offsets.map((offset, i) => (
                <line
                  key={i}
                  x1={x1 + px * offset}
                  y1={y1 + py * offset}
                  x2={x2 + px * offset}
                  y2={y2 + py * offset}
                  stroke={stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              ))}
            </g>
          );
        })}

        {molecule.atoms.map((atom) => {
          const label = labelFor(atom.id);
          const bondCount = molecule.bonds.filter((b) => b.a === atom.id || b.b === atom.id).length;
          return (
            <g key={atom.id}>
              {label ? (
                <text
                  x={atom.x}
                  y={atom.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={14}
                  fill={ELEMENT_COLOR[atom.element]}
                  stroke="#fff"
                  strokeWidth={5}
                  paintOrder="stroke"
                  className="font-medium"
                >
                  {label}
                </text>
              ) : bondCount === 0 ? (
                <circle cx={atom.x} cy={atom.y} r={3.5} fill="#18181b" />
              ) : null}
              <circle
                cx={atom.x}
                cy={atom.y}
                r={13}
                fill="transparent"
                stroke={hover === atom.id && !drag ? "#a1a1aa" : "transparent"}
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {Object.entries(highlight?.numbers ?? {}).map(([id, number]) => {
          const atom = byId.get(id);
          if (!atom) return null;
          const dir = outward.get(id) ?? { x: 0, y: -1 };
          const cx = atom.x + dir.x * 18;
          const cy = atom.y + dir.y * 18;
          return (
            <g key={`n-${id}`}>
              <circle cx={cx} cy={cy} r={9} fill="#fff" stroke={accent} strokeWidth={1.5} />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fill={accent}
                className="font-semibold"
              >
                {number}
              </text>
            </g>
          );
        })}

        {drag && drag.moved ? (
          <>
            <line
              x1={drag.from.x}
              y1={drag.from.y}
              x2={drag.to.x}
              y2={drag.to.y}
              stroke="#71717a"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={drag.to.x} cy={drag.to.y} r={5} fill="#71717a" opacity={0.35} />
          </>
        ) : null}
        </g>
      </svg>

      {guideLabels.map((label) => (
        <span
          key={`${label.text}-${label.x}-${label.y}`}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm"
          style={{
            left: label.x + pan.x,
            top: label.y + pan.y,
            color: GUIDE_COLOR[label.kind],
            borderColor: GUIDE_COLOR[label.kind],
          }}
        >
          {label.text}
        </span>
      ))}

      {molecule.atoms.length === 0 && !guide?.ghost && !readOnly ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Click to place a carbon, drag to draw a bond · Space / middle-drag to pan
        </p>
      ) : null}
    </div>
  );
}

export { BOND_LENGTH };
