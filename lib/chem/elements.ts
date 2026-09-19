export type Element = "C" | "O" | "N" | "F" | "Cl" | "Br" | "I";

export const ELEMENTS: Element[] = ["C", "O", "N", "F", "Cl", "Br", "I"];

/** How many bonds each element makes before it is full; the rest are implicit hydrogens. */
export const MAX_VALENCE: Record<Element, number> = { C: 4, O: 2, N: 3, F: 1, Cl: 1, Br: 1, I: 1 };

export const ATOMIC_NUMBER: Record<Element, number> = { C: 6, N: 7, O: 8, F: 9, Cl: 17, Br: 35, I: 53 };

export const HALOGENS: Element[] = ["F", "Cl", "Br", "I"];

export const HALOGEN_PREFIX: Record<string, string> = {
  F: "fluoro",
  Cl: "chloro",
  Br: "bromo",
  I: "iodo",
};

export const isHalogen = (element: Element) => HALOGENS.includes(element);
