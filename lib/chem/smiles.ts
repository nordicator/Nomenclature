import { BOND_LENGTH, growthPoint, type Point } from "./edit";
import { ELEMENTS, type Element } from "./elements";
import { buildGraph, findRings, neighbors } from "./graph";
import type { BondOrder, Molecule } from "./types";

export { BOND_LENGTH };

let counter = 0;
const nextId = (prefix: string) => `${prefix}${(counter++).toString(36)}`;

/**
 * Tiny SMILES subset: the elements C O N F Cl Br I, branches "( )", ring-closure
 * digits, and the bond symbols "-", "=", "#". Enough to seed examples and tests.
 */
export function parseSmiles(input: string): Molecule {
  const atoms: Molecule["atoms"] = [];
  const bonds: Molecule["bonds"] = [];
  const stack: string[] = [];
  const ringOpen = new Map<string, { atom: string; order: BondOrder }>();
  let previous: string | null = null;
  let pendingOrder: BondOrder = 1;

  const addBond = (a: string, b: string, order: BondOrder) => {
    bonds.push({ id: nextId("b"), a, b, order });
  };

  const text = input.replace(/\s/g, "");
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const ch = text[i];
    let symbol: Element | null = null;
    if (two === "Cl" || two === "Br") {
      symbol = two as Element;
      i += 2;
    } else if (ELEMENTS.includes(ch as Element)) {
      symbol = ch as Element;
      i += 1;
    } else {
      i += 1;
    }

    if (symbol) {
      const atom = { id: nextId("a"), x: 0, y: 0, element: symbol };
      atoms.push(atom);
      if (previous) addBond(previous, atom.id, pendingOrder);
      pendingOrder = 1;
      previous = atom.id;
      continue;
    }

    if (ch === "(") {
      if (previous) stack.push(previous);
    } else if (ch === ")") {
      previous = stack.pop() ?? previous;
    } else if (ch === "=") {
      pendingOrder = 2;
    } else if (ch === "#") {
      pendingOrder = 3;
    } else if (ch === "-") {
      pendingOrder = 1;
    } else if (/[0-9]/.test(ch)) {
      if (!previous) continue;
      const open = ringOpen.get(ch);
      if (open) {
        addBond(open.atom, previous, open.order === 1 ? pendingOrder : open.order);
        ringOpen.delete(ch);
      } else {
        ringOpen.set(ch, { atom: previous, order: pendingOrder });
      }
      pendingOrder = 1;
    }
  }
  return layout({ atoms, bonds });
}

/** Lays a molecule out as a skeletal drawing: one ring as a polygon, chains zig-zagging off it. */
export function layout(mol: Molecule): Molecule {
  const g = buildGraph(mol);
  const rings = findRings(g);
  const pos = new Map<string, Point>();
  const queue: string[] = [];

  const ring = rings.rings[0];
  if (ring) {
    const radius = BOND_LENGTH / (2 * Math.sin(Math.PI / ring.length));
    ring.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / ring.length - Math.PI / 2;
      pos.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      queue.push(id);
    });
  } else if (mol.atoms.length) {
    pos.set(mol.atoms[0].id, { x: 0, y: 0 });
    queue.push(mol.atoms[0].id);
  }

  // Grow the rest exactly the way the canvas grows a chain under the cursor.
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of neighbors(g, id)) {
      if (pos.has(n.atom)) continue;
      const placed = {
        atoms: mol.atoms.filter((a) => pos.has(a.id)).map((a) => ({ ...a, ...pos.get(a.id)! })),
        bonds: mol.bonds.filter((b) => pos.has(b.a) && pos.has(b.b)),
      };
      pos.set(n.atom, growthPoint(placed, id));
      queue.push(n.atom);
    }
  }

  const points = [...pos.values()];
  const minX = Math.min(...points.map((p) => p.x), 0);
  const minY = Math.min(...points.map((p) => p.y), 0);
  return {
    atoms: mol.atoms.map((a) => {
      const p = pos.get(a.id) ?? { x: 0, y: 0 };
      return { ...a, x: Math.round(p.x - minX), y: Math.round(p.y - minY) };
    }),
    bonds: mol.bonds,
  };
}

/** Centres a molecule inside a box. */
export function centerMolecule(mol: Molecule, width: number, height: number): Molecule {
  if (!mol.atoms.length) return mol;
  const xs = mol.atoms.map((a) => a.x);
  const ys = mol.atoms.map((a) => a.y);
  const dx = (width - (Math.max(...xs) + Math.min(...xs))) / 2;
  const dy = (height - (Math.max(...ys) + Math.min(...ys))) / 2;
  return {
    atoms: mol.atoms.map((a) => ({ ...a, x: Math.round(a.x + dx), y: Math.round(a.y + dy) })),
    bonds: mol.bonds,
  };
}
