import type { Element } from "./elements";

export type BondOrder = 1 | 2 | 3;

export type Atom = {
  id: string;
  x: number;
  y: number;
  element: Element;
};

export type Bond = {
  id: string;
  a: string;
  b: string;
  order: BondOrder;
};

/** Skeletal structure: hydrogens are implicit, everything else is drawn. */
export type Molecule = {
  atoms: Atom[];
  bonds: Bond[];
};

export const emptyMolecule = (): Molecule => ({ atoms: [], bonds: [] });
