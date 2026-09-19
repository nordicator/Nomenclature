import { ATOMIC_NUMBER } from "./elements";
import { element, neighbors, type Graph } from "./graph";
import type { Bond, Molecule } from "./types";

export type StereoDescriptor = "cis" | "trans";

export type Stereo = {
  bondId: string;
  locant: number;
  descriptor: StereoDescriptor;
  /** True when each end of the C=C carries a single group plus a hydrogen. */
  simple: boolean;
};

/**
 * CIP-style ranking, simplified: walk the branch sphere by sphere and compare the
 * atomic numbers found at each level (double bonds count their partner twice).
 * Enough for the substituents that turn up in a first organic course.
 */
function profile(g: Graph, from: string, root: string, depth = 6): number[] {
  const flat: number[] = [];
  let level: { atom: string; from: string }[] = [{ atom: root, from }];
  for (let i = 0; i < depth && level.length; i++) {
    const values: number[] = [];
    const next: { atom: string; from: string }[] = [];
    for (const node of level) {
      values.push(ATOMIC_NUMBER[element(g, node.atom)] ?? 0);
      for (const n of neighbors(g, node.atom)) {
        const weight = ATOMIC_NUMBER[element(g, n.atom)] ?? 0;
        if (n.atom === node.from) {
          // the bond back still counts for its duplicated atoms
          for (let d = 1; d < n.bond.order; d++) values.push(weight);
          continue;
        }
        next.push({ atom: n.atom, from: node.atom });
        for (let d = 1; d < n.bond.order; d++) values.push(weight);
      }
    }
    values.sort((a, b) => b - a);
    flat.push(...values, -1); // -1 separates spheres
    level = next;
  }
  return flat;
}

/** Positive when branch `a` outranks branch `b`. */
export function comparePriority(g: Graph, from: string, a: string, b: string): number {
  const left = profile(g, from, a);
  const right = profile(g, from, b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? -2;
    const y = right[i] ?? -2;
    if (x !== y) return x - y;
  }
  return 0;
}

function sideOf(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return Math.sign(cross);
}

/**
 * Works out cis/trans for one double bond straight from the drawing: which side of
 * the bond axis each substituent sits on. When a carbon carries two different groups
 * the higher-priority one (CIP) is the one that counts.
 */
export function bondStereo(
  g: Graph,
  mol: Molecule,
  bond: Bond,
  ringAtoms: Set<string>,
): { descriptor: StereoDescriptor; simple: boolean } | null {
  if (bond.order !== 2) return null;
  if (ringAtoms.has(bond.a) && ringAtoms.has(bond.b)) return null;

  const aSubs = neighbors(g, bond.a).filter((n) => n.atom !== bond.b);
  const bSubs = neighbors(g, bond.b).filter((n) => n.atom !== bond.a);
  if (!aSubs.length || !bSubs.length) return null;

  const tie = (from: string, subs: { atom: string }[]) =>
    subs.length === 2 && comparePriority(g, from, subs[0].atom, subs[1].atom) === 0;
  if (tie(bond.a, aSubs) || tie(bond.b, bSubs)) return null;

  const pick = (from: string, subs: { atom: string }[]) =>
    subs.length === 1
      ? subs[0].atom
      : comparePriority(g, from, subs[0].atom, subs[1].atom) > 0
        ? subs[0].atom
        : subs[1].atom;

  const atoms = new Map(mol.atoms.map((atom) => [atom.id, atom]));
  const a = atoms.get(bond.a)!;
  const b = atoms.get(bond.b)!;
  const topA = atoms.get(pick(bond.a, aSubs))!;
  const topB = atoms.get(pick(bond.b, bSubs))!;

  const sameSide = sideOf(a, b, topA) === sideOf(a, b, topB);
  return {
    descriptor: sameSide ? "cis" : "trans",
    simple: aSubs.length === 1 && bSubs.length === 1,
  };
}
