import { ATOMIC_NUMBER, MAX_VALENCE, type Element } from "./elements";
import { element, neighbors, type Graph } from "./graph";
import type { Bond, Molecule } from "./types";

/** cis/trans for disubstituted alkenes; E/Z once a third substituent appears. */
export type StereoDescriptor = "cis" | "trans" | "E" | "Z";

export type Stereo = {
  bondId: string;
  locant: number;
  descriptor: StereoDescriptor;
  /**
   * True when each end of the C=C has exactly one non-H substituent.
   * Only then is cis/trans unambiguous; otherwise we use E/Z (CIP).
   */
  simple: boolean;
};

/** Cross-product sign of point `p` relative to directed segment a→b. */
function sideOf(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * Which side of the double-bond axis a substituent leaves from.
 * Uses the bond vector (more stable than the atom centre alone when chains bend).
 * Returns null when the substituent sits nearly on the axis (ambiguous drawing).
 */
function substituentSide(
  alkene: { x: number; y: number },
  other: { x: number; y: number },
  sub: { x: number; y: number },
): number | null {
  const cross = sideOf(alkene, other, sub);
  const bondLen = Math.hypot(other.x - alkene.x, other.y - alkene.y) || 1;
  const subLen = Math.hypot(sub.x - alkene.x, sub.y - alkene.y) || 1;
  // ~8° of collinearity counts as "can't tell from this drawing"
  if (Math.abs(cross) < bondLen * subLen * 0.14) return null;
  return Math.sign(cross);
}

/**
 * CIP-style ranking of two substituents attached to `from`.
 * First compare the attached atoms' atomic numbers; then walk outward.
 * Implicit hydrogens count as atomic number 1; multiple bonds duplicate the partner.
 */
export function comparePriority(g: Graph, from: string, a: string, b: string): number {
  const za = ATOMIC_NUMBER[element(g, a)] ?? 0;
  const zb = ATOMIC_NUMBER[element(g, b)] ?? 0;
  if (za !== zb) return za - zb;

  type Node = { atom: string; parent: string };
  let frontierA: Node[] = [{ atom: a, parent: from }];
  let frontierB: Node[] = [{ atom: b, parent: from }];
  const seenA = new Set<string>([from, a]);
  const seenB = new Set<string>([from, b]);

  for (let depth = 0; depth < 10; depth++) {
    const sphereA = expandSphere(g, frontierA, seenA);
    const sphereB = expandSphere(g, frontierB, seenB);
    const n = Math.max(sphereA.ranks.length, sphereB.ranks.length);
    for (let i = 0; i < n; i++) {
      const x = sphereA.ranks[i] ?? 0;
      const y = sphereB.ranks[i] ?? 0;
      if (x !== y) return x - y;
    }
    frontierA = sphereA.next;
    frontierB = sphereB.next;
    if (!frontierA.length && !frontierB.length) break;
  }
  return 0;
}

function expandSphere(
  g: Graph,
  frontier: { atom: string; parent: string }[],
  seen: Set<string>,
): { ranks: number[]; next: { atom: string; parent: string }[] } {
  const ranks: number[] = [];
  const next: { atom: string; parent: string }[] = [];
  for (const { atom, parent } of frontier) {
    let bonded = 0;
    for (const n of neighbors(g, atom)) {
      bonded += n.bond.order;
      const z = ATOMIC_NUMBER[element(g, n.atom) as Element] ?? 0;
      // Duplicate ghost atoms for double/triple bonds (CIP).
      for (let d = 0; d < n.bond.order; d++) ranks.push(z);
      if (n.atom !== parent && !seen.has(n.atom)) {
        seen.add(n.atom);
        next.push({ atom: n.atom, parent: atom });
      }
    }
    const hydrogens = Math.max(0, MAX_VALENCE[element(g, atom)] - bonded);
    for (let h = 0; h < hydrogens; h++) ranks.push(1);
  }
  ranks.sort((a, b) => b - a);
  return { ranks, next };
}

function pickHigher(
  g: Graph,
  from: string,
  subs: { atom: string }[],
): string | null {
  if (subs.length === 1) return subs[0].atom;
  if (subs.length !== 2) return null;
  const cmp = comparePriority(g, from, subs[0].atom, subs[1].atom);
  if (cmp === 0) return null; // identical substituents → no isomerism
  return cmp > 0 ? subs[0].atom : subs[1].atom;
}

/**
 * Stereochemistry of one C=C from the drawing.
 *
 * Rules (as taught in intro organic, matching IUPAC practice):
 * - Each end of the double bond must have two different substituents (or one
 *   substituent + H). If either end has two identical groups, no label.
 * - Geometry: are the two ranking substituents on the same side of the C=C axis?
 * - If each end has exactly one non-H substituent (disubstituted alkene) → cis/trans.
 * - If either end has two non-H substituents (tri/tetrasubstituted) → E/Z by CIP,
 *   because cis/trans would be ambiguous about which groups you mean.
 */
export function bondStereo(
  g: Graph,
  mol: Molecule,
  bond: Bond,
  ringAtoms: Set<string>,
): { descriptor: StereoDescriptor; simple: boolean } | null {
  if (bond.order !== 2) return null;
  // Ring alkenes don't get open-chain cis/trans in this course.
  if (ringAtoms.has(bond.a) && ringAtoms.has(bond.b)) return null;

  const aSubs = neighbors(g, bond.a).filter((n) => n.atom !== bond.b);
  const bSubs = neighbors(g, bond.b).filter((n) => n.atom !== bond.a);
  // Terminal =CH2 (or bare end) has nothing to compare.
  if (!aSubs.length || !bSubs.length) return null;
  if (aSubs.length > 2 || bSubs.length > 2) return null;

  const topA = pickHigher(g, bond.a, aSubs);
  const topB = pickHigher(g, bond.b, bSubs);
  if (!topA || !topB) return null;

  const atoms = new Map(mol.atoms.map((atom) => [atom.id, atom]));
  const a = atoms.get(bond.a)!;
  const b = atoms.get(bond.b)!;
  const subA = atoms.get(topA)!;
  const subB = atoms.get(topB)!;

  const sideA = substituentSide(a, b, subA);
  const sideB = substituentSide(b, a, subB);
  // Note: sideB uses b→a so a positive side is mirrored; flip to share a's frame.
  // substituentSide(b, a, subB) positive means subB is on the opposite half-plane
  // from substituentSide(a, b, ·) positive — so same geometric side of the bond
  // when sideA === -sideB.
  if (sideA === null || sideB === null) return null;
  const sameSide = sideA === -sideB;

  const simple = aSubs.length === 1 && bSubs.length === 1;
  if (simple) {
    return { descriptor: sameSide ? "cis" : "trans", simple: true };
  }
  // Tri- or tetrasubstituted: CIP priorities already picked; report E/Z.
  return { descriptor: sameSide ? "Z" : "E", simple: false };
}

/** Tag written next to a locant: cis-2, (Z)-2, … */
export function stereoTag(descriptor: StereoDescriptor, locant: number): string {
  if (descriptor === "E" || descriptor === "Z") return `(${descriptor})-${locant}`;
  return `${descriptor}-${locant}`;
}
