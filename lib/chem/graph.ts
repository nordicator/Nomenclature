import { MAX_VALENCE, type Element } from "./elements";
import type { Atom, Bond, Molecule } from "./types";

export type Neighbor = { atom: string; bond: Bond };

export type Graph = {
  ids: string[];
  bonds: Bond[];
  atoms: Map<string, Atom>;
  adj: Map<string, Neighbor[]>;
};

export function buildGraph(mol: Molecule): Graph {
  const adj = new Map<string, Neighbor[]>();
  for (const atom of mol.atoms) adj.set(atom.id, []);
  for (const bond of mol.bonds) {
    if (!adj.has(bond.a) || !adj.has(bond.b)) continue;
    adj.get(bond.a)!.push({ atom: bond.b, bond });
    adj.get(bond.b)!.push({ atom: bond.a, bond });
  }
  return {
    ids: mol.atoms.map((a) => a.id),
    bonds: mol.bonds,
    atoms: new Map(mol.atoms.map((a) => [a.id, a])),
    adj,
  };
}

export function neighbors(g: Graph, id: string): Neighbor[] {
  return g.adj.get(id) ?? [];
}

export function bondBetween(g: Graph, a: string, b: string): Bond | undefined {
  return neighbors(g, a).find((n) => n.atom === b)?.bond;
}

/** Total bond order on an atom (how many of its slots are used). */
export function valence(g: Graph, id: string): number {
  return neighbors(g, id).reduce((sum, n) => sum + n.bond.order, 0);
}

export function element(g: Graph, id: string): Element {
  return g.atoms.get(id)?.element ?? "C";
}

export function isCarbon(g: Graph, id: string): boolean {
  return element(g, id) === "C";
}

export function hydrogens(g: Graph, id: string): number {
  return Math.max(0, MAX_VALENCE[element(g, id)] - valence(g, id));
}

/** Carbon neighbours only — the skeleton that parent chains are built from. */
export function carbonNeighbors(g: Graph, id: string): Neighbor[] {
  return neighbors(g, id).filter((n) => isCarbon(g, n.atom));
}

export function components(g: Graph): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of g.ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const group: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const n of neighbors(g, cur)) {
        if (!seen.has(n.atom)) {
          seen.add(n.atom);
          stack.push(n.atom);
        }
      }
    }
    out.push(group);
  }
  return out;
}

function connectedWithout(g: Graph, from: string, to: string, skipBond: string): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    for (const n of neighbors(g, cur)) {
      if (n.bond.id === skipBond || seen.has(n.atom)) continue;
      seen.add(n.atom);
      stack.push(n.atom);
    }
  }
  return false;
}

export type RingInfo = {
  /** Each ring as an ordered walk of atom ids. */
  rings: string[][];
  /** Atoms that sit on any ring. */
  ringAtoms: Set<string>;
  /** True when rings share atoms (fused / bridged / spiro) — not supported. */
  fused: boolean;
};

/**
 * Finds rings by testing which bonds are "bridges". A bond whose removal keeps
 * its two ends connected must lie on a cycle. Only simple, non-fused rings get
 * walked into an ordered ring; anything sharing atoms is reported as fused.
 */
export function findRings(g: Graph): RingInfo {
  const ringBonds = g.bonds.filter((b) => connectedWithout(g, b.a, b.b, b.id));
  const ringAtoms = new Set<string>();
  for (const b of ringBonds) {
    ringAtoms.add(b.a);
    ringAtoms.add(b.b);
  }
  if (ringBonds.length === 0) return { rings: [], ringAtoms, fused: false };

  const ringAdj = new Map<string, Neighbor[]>();
  for (const id of ringAtoms) ringAdj.set(id, []);
  for (const bond of ringBonds) {
    ringAdj.get(bond.a)!.push({ atom: bond.b, bond });
    ringAdj.get(bond.b)!.push({ atom: bond.a, bond });
  }

  let fused = false;
  const rings: string[][] = [];
  const seen = new Set<string>();
  for (const start of ringAtoms) {
    if (seen.has(start)) continue;
    // Collect this ring-system component.
    const group: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const n of ringAdj.get(cur)!) {
        if (!seen.has(n.atom)) {
          seen.add(n.atom);
          stack.push(n.atom);
        }
      }
    }
    const simple = group.every((id) => ringAdj.get(id)!.length === 2);
    if (!simple) {
      fused = true;
      continue;
    }
    // Walk the cycle in order.
    const ring: string[] = [group[0]];
    let prev = "";
    let cur = group[0];
    while (true) {
      const next = ringAdj.get(cur)!.find((n) => n.atom !== prev)!.atom;
      if (next === ring[0]) break;
      ring.push(next);
      prev = cur;
      cur = next;
    }
    rings.push(ring);
  }
  return { rings, ringAtoms, fused };
}

/** Unique path between two atoms inside `allowed` (the graph there is a tree). */
export function pathBetween(g: Graph, from: string, to: string, allowed: Set<string>): string[] | null {
  const prev = new Map<string, string>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path = [cur];
      let walk = cur;
      while (prev.has(walk)) {
        walk = prev.get(walk)!;
        path.push(walk);
      }
      return path.reverse();
    }
    for (const n of neighbors(g, cur)) {
      if (!allowed.has(n.atom) || seen.has(n.atom)) continue;
      seen.add(n.atom);
      prev.set(n.atom, cur);
      queue.push(n.atom);
    }
  }
  return null;
}

/** Every atom reachable from `root` without stepping into `blocked`. */
export function collectBranch(g: Graph, root: string, blocked: Set<string>): string[] {
  const seen = new Set([root]);
  const stack = [root];
  const out: string[] = [];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const n of neighbors(g, cur)) {
      if (blocked.has(n.atom) || seen.has(n.atom)) continue;
      seen.add(n.atom);
      stack.push(n.atom);
    }
  }
  return out;
}

/** Bond ids with both ends inside the given set. */
export function bondsWithin(g: Graph, atoms: Iterable<string>): string[] {
  const set = new Set(atoms);
  return g.bonds.filter((b) => set.has(b.a) && set.has(b.b)).map((b) => b.id);
}

export function compareNumbers(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? Infinity;
    const y = b[i] ?? Infinity;
    if (x !== y) return x - y;
  }
  return 0;
}
