import { buildGraph, findRings } from "./graph";
import { nameMolecule, type Analysis, type NameOptions } from "./name";
import type { Molecule } from "./types";

export type NameVariant = { name: string; note: string };

/** cis/trans is how the app spells it; E/Z says the same thing in CIP letters. */
function ezVersion(name: string, analysis: Analysis): string | null {
  const { stereo } = analysis;
  if (!stereo.length) return null;
  const letter = (descriptor: string) => (descriptor === "cis" ? "Z" : "E");
  const single = stereo.length === 1 && analysis.eneLocants.length === 1;
  const cisPrefix = single
    ? `${stereo[0].descriptor}-`
    : `${stereo.map((s) => `${s.descriptor}-${s.locant}`).join(",")}-`;
  if (!name.startsWith(cisPrefix)) return null;
  const ezPrefix = single
    ? `(${letter(stereo[0].descriptor)})-`
    : `(${stereo.map((s) => `${s.locant}${letter(s.descriptor)}`).join(",")})-`;
  return ezPrefix + name.slice(cisPrefix.length);
}

function isStraightAlkane(mol: Molecule): boolean {
  const g = buildGraph(mol);
  if (findRings(g).rings.length) return false;
  if (mol.atoms.some((atom) => atom.element !== "C")) return false;
  if (mol.bonds.some((bond) => bond.order !== 1)) return false;
  return mol.atoms.every(
    (atom) => mol.bonds.filter((b) => b.a === atom.id || b.b === atom.id).length <= 2,
  );
}

const SPELLINGS: { options: NameOptions; note: string }[] = [
  { options: { style: "classic" }, note: "older locant style" },
  { options: { commonAlkyl: false }, note: "systematic substituent" },
  { options: { keepLocants: true }, note: "with the optional locants" },
  { options: { style: "classic", keepLocants: true }, note: "older style, full locants" },
  { options: { style: "classic", commonAlkyl: false }, note: "older style, systematic" },
];

/** The name the app shows, plus the other spellings that are still correct. */
export function nameVariants(mol: Molecule): { primary: string | null; alternatives: NameVariant[] } {
  const modern = nameMolecule(mol);
  if (!modern.ok) return { primary: null, alternatives: [] };

  const seen = new Set([modern.name]);
  const alternatives: NameVariant[] = [];
  const add = (name: string | null | undefined, note: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    alternatives.push({ name, note });
  };

  for (const spelling of SPELLINGS) {
    const named = nameMolecule(mol, spelling.options);
    if (named.ok) add(named.name, spelling.note);
  }
  add(ezVersion(modern.name, modern.analysis), "E/Z instead of cis/trans");
  if (isStraightAlkane(mol) && mol.atoms.length >= 4) add(`n-${modern.name}`, "retained “n-” prefix");

  return { primary: modern.name, alternatives };
}

/** Every spelling accepted as a correct answer, normalised for comparison. */
export function acceptedNames(mol: Molecule): string[] {
  const { primary, alternatives } = nameVariants(mol);
  if (!primary) return [];
  const names = [primary, ...alternatives.map((a) => a.name)];
  for (const spelling of SPELLINGS) {
    const named = nameMolecule(mol, spelling.options);
    if (named.ok) {
      const ez = ezVersion(named.name, named.analysis);
      if (ez) names.push(ez);
    }
  }
  return [...new Set(names.map(normaliseName))];
}

/** Loose comparison: case, spacing and punctuation don't matter, locants and words do. */
export function normaliseName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\bt-/g, "tert-")
    .replace(/\bs-/g, "sec-")
    .replace(/^n[\s-]+/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function checkName(input: string, mol: Molecule): boolean {
  const answer = normaliseName(input);
  return answer ? acceptedNames(mol).includes(answer) : false;
}
