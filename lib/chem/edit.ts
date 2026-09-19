import { MAX_VALENCE, type Element } from "./elements";
import { buildGraph, collectBranch, neighbors, valence } from "./graph";
import type { Atom, Bond, BondOrder, Molecule } from "./types";

export type Point = { x: number; y: number };

/** Every bond is drawn the same length, on a 30° lattice. */
export const BOND_LENGTH = 52;

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const SNAP_ANGLE = Math.PI / 6; // 30°

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function atomAt(mol: Molecule, p: Point, radius = 16): Atom | undefined {
  let best: Atom | undefined;
  let bestDistance = radius;
  for (const atom of mol.atoms) {
    const d = distance(atom, p);
    if (d <= bestDistance) {
      best = atom;
      bestDistance = d;
    }
  }
  return best;
}

export function bondAt(mol: Molecule, p: Point, radius = 10): Bond | undefined {
  const byId = new Map(mol.atoms.map((a) => [a.id, a]));
  let best: Bond | undefined;
  let bestDistance = radius;
  for (const bond of mol.bonds) {
    const a = byId.get(bond.a);
    const b = byId.get(bond.b);
    if (!a || !b) continue;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const d = distance(p, { x: a.x + t * vx, y: a.y + t * vy });
    if (d <= bestDistance) {
      best = bond;
      bestDistance = d;
    }
  }
  return best;
}

/** Nearest point on the 30° lattice around `origin`, one bond length away. */
export function snapFrom(origin: Point, target: Point): Point {
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  const snapped = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
  return {
    x: origin.x + BOND_LENGTH * Math.cos(snapped),
    y: origin.y + BOND_LENGTH * Math.sin(snapped),
  };
}

/** A sensible empty direction to grow from `atomId` — 120° from the existing bonds. */
export function growthPoint(mol: Molecule, atomId: string): Point {
  const g = buildGraph(mol);
  const atom = mol.atoms.find((a) => a.id === atomId)!;
  const existing = neighbors(g, atomId).map((n) => {
    const other = mol.atoms.find((a) => a.id === n.atom)!;
    return Math.atan2(other.y - atom.y, other.x - atom.x);
  });

  const IDEAL = (Math.PI * 2) / 3; // skeletal drawings sit at 120°
  const candidates: number[] = [];
  if (existing.length === 1) {
    // the two directions that make a proper 120° corner
    candidates.push(existing[0] - IDEAL, existing[0] + IDEAL);
  }
  for (let i = 0; i < 12; i++) candidates.push(i * SNAP_ANGLE);

  let best: Point | null = null;
  let bestScore = -Infinity;
  for (const angle of candidates) {
    const p = { x: atom.x + BOND_LENGTH * Math.cos(angle), y: atom.y + BOND_LENGTH * Math.sin(angle) };
    const spread = existing.length
      ? Math.min(...existing.map((e) => Math.abs(normalise(angle - e))))
      : Math.PI;
    if (spread < Math.PI / 3 - 0.01) continue;
    const clearance = Math.min(
      ...mol.atoms.filter((a) => a.id !== atomId).map((a) => distance(a, p)),
      BOND_LENGTH * 2,
    );
    if (clearance < BOND_LENGTH * 0.7) continue;
    // 120° corners first, then keep the classic left-to-right zig-zag at ±30° from flat
    const zigzag = Math.abs(Math.abs(normalise(angle)) - Math.PI / 6) < 0.01 ? 0.3 : 0;
    const score =
      -Math.abs(spread - IDEAL) * 3 + clearance / BOND_LENGTH + Math.cos(angle) * 0.4 + zigzag;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ?? { x: atom.x + BOND_LENGTH, y: atom.y };
}

function normalise(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function atomValence(mol: Molecule, id: string): number {
  return valence(buildGraph(mol), id);
}

export function addAtom(
  mol: Molecule,
  p: Point,
  element: Element = "C",
): { molecule: Molecule; id: string } {
  const atom: Atom = { id: newId("a"), x: Math.round(p.x), y: Math.round(p.y), element };
  return { molecule: { atoms: [...mol.atoms, atom], bonds: mol.bonds }, id: atom.id };
}

/** Draws a bond from an atom (or a fresh atom at `from`) to an atom (or a fresh atom at `to`). */
export function connect(
  mol: Molecule,
  from: { id?: string; point: Point },
  to: { id?: string; point: Point; element?: Element },
  order: BondOrder,
): Molecule {
  let next = mol;
  let fromId = from.id;
  let toId = to.id;
  if (!fromId) {
    const added = addAtom(next, from.point);
    next = added.molecule;
    fromId = added.id;
  }
  if (!toId) {
    const added = addAtom(next, to.point, to.element ?? "C");
    next = added.molecule;
    toId = added.id;
  }
  if (fromId === toId) return next;
  const existing = next.bonds.find(
    (b) => (b.a === fromId && b.b === toId) || (b.a === toId && b.b === fromId),
  );
  if (existing) {
    return setBondOrder(next, existing.id, order);
  }
  return {
    atoms: next.atoms,
    bonds: [...next.bonds, { id: newId("b"), a: fromId, b: toId, order }],
  };
}

/** Would turning this bond into a double/triple push either atom past its valence? */
export function canSetOrder(mol: Molecule, bondId: string, order: BondOrder): boolean {
  const bond = mol.bonds.find((b) => b.id === bondId);
  if (!bond) return false;
  const delta = order - bond.order;
  return [bond.a, bond.b].every((id) => atomValence(mol, id) + delta <= MAX_VALENCE[elementOf(mol, id)]);
}

export function setBondOrder(mol: Molecule, bondId: string, order: BondOrder): Molecule {
  return {
    atoms: mol.atoms,
    bonds: mol.bonds.map((b) => (b.id === bondId ? { ...b, order } : b)),
  };
}

export function removeBond(mol: Molecule, bondId: string): Molecule {
  const bond = mol.bonds.find((b) => b.id === bondId);
  const bonds = mol.bonds.filter((b) => b.id !== bondId);
  if (!bond) return mol;
  // Drop carbons that are left floating on their own.
  const stillUsed = new Set(bonds.flatMap((b) => [b.a, b.b]));
  const atoms = mol.atoms.filter(
    (a) => stillUsed.has(a.id) || (a.id !== bond.a && a.id !== bond.b),
  );
  return { atoms, bonds };
}

export function moveAtom(mol: Molecule, atomId: string, p: Point): Molecule {
  return {
    atoms: mol.atoms.map((a) =>
      a.id === atomId ? { ...a, x: Math.round(p.x), y: Math.round(p.y) } : a,
    ),
    bonds: mol.bonds,
  };
}

/** Could this atom become that element without breaking its bond count? */
export function canBeElement(mol: Molecule, atomId: string, element: Element): boolean {
  return atomValence(mol, atomId) <= MAX_VALENCE[element];
}

export function setAtomElement(mol: Molecule, atomId: string, element: Element): Molecule {
  if (!canBeElement(mol, atomId, element)) return mol;
  return {
    atoms: mol.atoms.map((a) => (a.id === atomId ? { ...a, element } : a)),
    bonds: mol.bonds,
  };
}

/** Where a new bond off `atomId` should land, or null when the atom is already full. */
export function nextGrowthPoint(mol: Molecule, atomId: string, order: BondOrder = 1): Point | null {
  return freeSlots(mol, atomId) >= order ? growthPoint(mol, atomId) : null;
}

export function removeAtom(mol: Molecule, atomId: string): Molecule {
  return {
    atoms: mol.atoms.filter((a) => a.id !== atomId),
    bonds: mol.bonds.filter((b) => b.a !== atomId && b.b !== atomId),
  };
}

export function elementOf(mol: Molecule, id: string): Element {
  return mol.atoms.find((a) => a.id === id)?.element ?? "C";
}

export function hydrogenCount(mol: Molecule, id: string): number {
  return Math.max(0, MAX_VALENCE[elementOf(mol, id)] - atomValence(mol, id));
}

export function freeSlots(mol: Molecule, id: string): number {
  return MAX_VALENCE[elementOf(mol, id)] - atomValence(mol, id);
}

/** Ready-made groups you can stamp onto an atom instead of drawing every bond. */
export const GROUP_STAMPS = {
  OH: { label: "\u2013OH", title: "alcohol", slots: 1 },
  O: { label: "=O", title: "carbonyl", slots: 2 },
  CHO: { label: "\u2013CHO", title: "aldehyde", slots: 1 },
  COOH: { label: "\u2013COOH", title: "carboxylic acid", slots: 1 },
  NH2: { label: "\u2013NH\u2082", title: "amine", slots: 1 },
  CN: { label: "\u2013C\u2261N", title: "nitrile", slots: 1 },
  OMe: { label: "\u2013OCH\u2083", title: "ether", slots: 1 },
} as const;

export type GroupStamp = keyof typeof GROUP_STAMPS;

/** Hangs a whole functional group off `atomId`, laying its atoms out as it goes. */
export function stampGroup(mol: Molecule, atomId: string, stamp: GroupStamp): Molecule {
  if (freeSlots(mol, atomId) < GROUP_STAMPS[stamp].slots) return mol;
  const grow = (current: Molecule, from: string, element: Element, order: BondOrder) => {
    const point = growthPoint(current, from);
    const next = connect(current, { id: from, point: { x: 0, y: 0 } }, { point, element }, order);
    return { molecule: next, id: next.atoms[next.atoms.length - 1].id };
  };

  switch (stamp) {
    case "OH":
      return grow(mol, atomId, "O", 1).molecule;
    case "O":
      return grow(mol, atomId, "O", 2).molecule;
    case "NH2":
      return grow(mol, atomId, "N", 1).molecule;
    case "OMe": {
      const oxygen = grow(mol, atomId, "O", 1);
      return grow(oxygen.molecule, oxygen.id, "C", 1).molecule;
    }
    case "CHO": {
      const carbon = grow(mol, atomId, "C", 1);
      return grow(carbon.molecule, carbon.id, "O", 2).molecule;
    }
    case "CN": {
      const carbon = grow(mol, atomId, "C", 1);
      return grow(carbon.molecule, carbon.id, "N", 3).molecule;
    }
    case "COOH": {
      const carbon = grow(mol, atomId, "C", 1);
      const carbonyl = grow(carbon.molecule, carbon.id, "O", 2);
      return grow(carbonyl.molecule, carbon.id, "O", 1).molecule;
    }
    default:
      return mol;
  }
}

/** Mirrors one side of a double bond across it — flips cis into trans and back. */
export function reflectAcrossBond(mol: Molecule, bondId: string): Molecule {
  const bond = mol.bonds.find((b) => b.id === bondId);
  if (!bond) return mol;
  const a = mol.atoms.find((atom) => atom.id === bond.a);
  const b = mol.atoms.find((atom) => atom.id === bond.b);
  if (!a || !b) return mol;
  const moving = new Set(collectBranch(buildGraph(mol), bond.b, new Set([bond.a])));
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return {
    atoms: mol.atoms.map((atom) => {
      if (!moving.has(atom.id)) return atom;
      const vx = atom.x - a.x;
      const vy = atom.y - a.y;
      const dot = vx * ux + vy * uy;
      return {
        ...atom,
        x: Math.round(a.x + 2 * dot * ux - vx),
        y: Math.round(a.y + 2 * dot * uy - vy),
      };
    }),
    bonds: mol.bonds,
  };
}

/** Shifts every atom so the drawing sits in the middle of a w×h canvas. */
export function centreIn(mol: Molecule, width: number, height: number): Molecule {
  if (!mol.atoms.length) return mol;
  const xs = mol.atoms.map((a) => a.x);
  const ys = mol.atoms.map((a) => a.y);
  const dx = width / 2 - (Math.max(...xs) + Math.min(...xs)) / 2;
  const dy = height / 2 - (Math.max(...ys) + Math.min(...ys)) / 2;
  return {
    atoms: mol.atoms.map((a) => ({ ...a, x: Math.round(a.x + dx), y: Math.round(a.y + dy) })),
    bonds: mol.bonds,
  };
}
