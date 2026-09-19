import { reflectAcrossBond } from "./edit";
import { buildGraph, findRings } from "./graph";
import { nameMolecule } from "./name";
import { parseSmiles } from "./smiles";
import { makeSeed, rngFor, type Rng } from "./rng";
import { bondStereo } from "./stereo";
import type { Molecule } from "./types";

export type Example = { label: string; smiles: string };

export const EXAMPLES: Example[] = [
  { label: "2-methylbutane", smiles: "CC(C)CC" },
  { label: "4-ethyl-3-methyloctane", smiles: "CCC(C)C(CC)CCCC" },
  { label: "4-isopropylheptane", smiles: "CCCC(C(C)C)CCC" },
  { label: "trans-pent-2-ene", smiles: "CC=CCC" },
  { label: "pent-1-en-4-yne", smiles: "C#CCC=C" },
  { label: "methylcyclohexane", smiles: "CC1CCCCC1" },
  { label: "benzene", smiles: "C1=CC=CC=C1" },
  { label: "propan-2-ol", smiles: "CC(O)C" },
  { label: "pentan-2-one", smiles: "CCCC(=O)C" },
  { label: "butanal", smiles: "CCCC=O" },
  { label: "3-hydroxybutanoic acid", smiles: "CC(O)CC(=O)O" },
  { label: "ethyl ethanoate", smiles: "CC(=O)OCC" },
  { label: "N-methylethanamide", smiles: "CC(=O)NC" },
  { label: "propan-1-amine", smiles: "CCCN" },
  { label: "propanenitrile", smiles: "CCC#N" },
  { label: "methoxyethane", smiles: "CCOC" },
  { label: "1,2-dichloropropane", smiles: "ClCC(Cl)C" },
  { label: "phenol", smiles: "OC1=CC=CC=C1" },
  { label: "benzoic acid", smiles: "OC(=O)C1=CC=CC=C1" },
];

/* ------------------------------------------------------------------ */
/* Challenge generation                                                */
/* ------------------------------------------------------------------ */

export type GroupOption =
  | "branched"
  | "alkene"
  | "alkyne"
  | "cistrans"
  | "ring"
  | "benzene"
  | "halide"
  | "alcohol"
  | "ether"
  | "aldehyde"
  | "ketone"
  | "acid"
  | "ester"
  | "amine"
  | "amide"
  | "nitrile";

export const GROUP_OPTIONS: { id: GroupOption; label: string; note: string }[] = [
  { id: "branched", label: "Branched alkanes", note: "methyl, ethyl, isopropyl…" },
  { id: "alkene", label: "Alkenes", note: "C=C, -ene" },
  { id: "alkyne", label: "Alkynes", note: "C≡C, -yne" },
  { id: "cistrans", label: "cis / trans", note: "geometry across a C=C" },
  { id: "ring", label: "Rings", note: "cyclopentane, cyclohexane" },
  { id: "benzene", label: "Benzene rings", note: "phenyl, benzene" },
  { id: "halide", label: "Halogens", note: "chloro, bromo…" },
  { id: "alcohol", label: "Alcohols", note: "-OH, -ol" },
  { id: "ether", label: "Ethers", note: "methoxy, ethoxy" },
  { id: "aldehyde", label: "Aldehydes", note: "-CHO, -al" },
  { id: "ketone", label: "Ketones", note: "C=O, -one" },
  { id: "acid", label: "Carboxylic acids", note: "-COOH, -oic acid" },
  { id: "ester", label: "Esters", note: "-COO-, -oate" },
  { id: "amine", label: "Amines", note: "-NH₂, -amine" },
  { id: "amide", label: "Amides", note: "-CONH₂, -amide" },
  { id: "nitrile", label: "Nitriles", note: "-C≡N, -nitrile" },
];

export const DEFAULT_GROUPS: GroupOption[] = ["branched", "alkene", "alcohol"];

export type Difficulty = "easy" | "medium" | "hard" | "bs";

/** How locked the run is once it starts. */
export type RunPace = "strict" | "casual";

type Pick = <T>(items: T[]) => T;

const BRANCHES = ["C", "C", "CC", "C(C)C", "CCC"];
const BS_BRANCHES = ["C", "CC", "C(C)C", "CCC", "C(C)(C)C", "CC(C)C", "CCC(C)C", "C(CC)C", "CCCC"];
const HALOGENS = ["Cl", "Br", "F", "I"];

type Skeleton = { chain: number; slots: string[][]; bonds: string[]; tail?: string; prefix?: string };

function emptySkeleton(chain: number): Skeleton {
  return { chain, slots: Array.from({ length: chain }, () => []), bonds: Array(chain).fill("") };
}

function renderSkeleton(s: Skeleton): string {
  let out = s.prefix ?? "";
  for (let i = 0; i < s.chain; i++) {
    if (i > 0) out += s.bonds[i - 1];
    out += "C";
    for (const branch of s.slots[i]) out += `(${branch})`;
  }
  return out + (s.tail ?? "");
}

/** Positions that can carry a group without turning the name into a mess. */
const innerSlots = (chain: number) =>
  chain <= 2 ? [0] : Array.from({ length: chain - 2 }, (_, i) => i + 1);

/** Groups that read better drawn on a ring than on a chain. */
const RING_TEMPLATES: Partial<Record<GroupOption, { ring?: string; benzene?: string }>> = {
  alcohol: { ring: "OC1CCCCC1", benzene: "OC1=CC=CC=C1" },
  ketone: { ring: "O=C1CCCCC1" },
  acid: { ring: "OC(=O)C1CCCCC1", benzene: "OC(=O)C1=CC=CC=C1" },
  aldehyde: { ring: "O=CC1CCCCC1", benzene: "O=CC1=CC=CC=C1" },
  amine: { ring: "NC1CCCCC1", benzene: "NC1=CC=CC=C1" },
  nitrile: { benzene: "N#CC1=CC=CC=C1" },
  halide: { benzene: "ClC1=CC=CC=C1" },
  ester: { benzene: "COC(=O)C1=CC=CC=C1" },
};

function buildMolecule(groups: GroupOption[], difficulty: Difficulty, rng: Rng): string {
  const pick: Pick = (items) => items[Math.floor(rng() * items.length)];
  const chance = (p: number) => rng() < p;
  const enabled = new Set(groups);
  const bs = difficulty === "bs";
  const families = groups.filter((id) => id !== "branched" && id !== "cistrans");
  let family = families.length ? pick(families) : "branched";
  if (enabled.has("cistrans") && !["ring", "benzene"].includes(family) && chance(bs ? 0.75 : 0.6)) {
    family = "alkene";
  }

  const template = RING_TEMPLATES[family as GroupOption];
  if (template && chance(bs ? 0.45 : 0.4)) {
    const onBenzene = enabled.has("benzene") && template.benzene;
    const onRing = enabled.has("ring") && template.ring;
    const base = onBenzene && (!onRing || chance(0.5)) ? template.benzene : onRing ? template.ring : null;
    if (base) {
      if (!bs) return base;
      const extras = [
        enabled.has("branched") && chance(0.8) ? `(${pick(BS_BRANCHES)})` : "",
        enabled.has("halide") && chance(0.6) ? `(${pick(HALOGENS)})` : "",
      ].filter(Boolean);
      return base + extras.join("");
    }
  }

  let size =
    difficulty === "easy"
      ? 3 + Math.floor(rng() * 2)
      : difficulty === "medium"
        ? 4 + Math.floor(rng() * 3)
        : difficulty === "hard"
          ? 5 + Math.floor(rng() * 4)
          : 6 + Math.floor(rng() * 4); // BS: 6–9 — wild names, still nameable fast
  if (enabled.has("cistrans") && family === "alkene") size = Math.max(size, 4);

  if (family === "benzene" || family === "ring") {
    const ringSmiles = family === "benzene" ? "C1(@)=CC=CC=C1" : pick(["C1(@)CCCCC1", "C1(@)CCCC1"]);
    const branchPool = bs ? BS_BRANCHES : BRANCHES;
    const branch = enabled.has("branched") && chance(bs ? 0.9 : 0.7) ? pick(branchPool) : "C";
    const extra = enabled.has("halide") && chance(bs ? 0.7 : 0.4) ? `(${pick(HALOGENS)})` : "";
    const more =
      bs && enabled.has("branched") && chance(0.5) ? `(${pick(branchPool)})` : "";
    return ringSmiles.replace("@", branch) + extra + more;
  }

  const skeleton = emptySkeleton(size);
  const slots = innerSlots(size);
  const branchPool = bs ? BS_BRANCHES : BRANCHES;

  const attach = (value: string, where = pick(slots)) => skeleton.slots[where].push(value);

  const internalBond = () => {
    const options = Array.from({ length: Math.max(size - 3, 0) }, (_, i) => i + 1);
    return options.length ? pick(options) : 0;
  };

  switch (family) {
    case "alkene":
      skeleton.bonds[enabled.has("cistrans") ? internalBond() : pick(slots.map((i) => i - 1).filter((i) => i >= 0))] = "=";
      if (bs && chance(0.4)) {
        const options = slots.map((i) => i - 1).filter((i) => i >= 0 && !skeleton.bonds[i]);
        if (options.length) skeleton.bonds[pick(options)] = "=";
      }
      break;
    case "alkyne":
      skeleton.bonds[0] = "#";
      break;
    case "halide":
      attach(pick(HALOGENS));
      if (difficulty !== "easy" && chance(bs ? 0.7 : 0.4)) attach(pick(HALOGENS));
      if (bs && chance(0.45)) attach(pick(HALOGENS));
      break;
    case "alcohol":
      attach("O");
      if ((difficulty === "hard" || bs) && chance(bs ? 0.45 : 0.3)) attach("O");
      break;
    case "ether":
      attach(pick(bs ? ["OC", "OCC", "OC(C)C"] : ["OC", "OCC"]));
      break;
    case "amine":
      attach(bs && chance(0.4) ? pick(["N", "NC"]) : "N");
      break;
    case "ketone":
      attach("=O");
      break;
    case "aldehyde":
      skeleton.tail = "C=O";
      break;
    case "acid":
      skeleton.tail = "C(=O)O";
      break;
    case "ester":
      skeleton.tail = `C(=O)O${pick(bs ? ["C", "CC", "CCC", "C(C)C"] : ["C", "CC", "CCC"])}`;
      break;
    case "amide":
      skeleton.tail = chance(bs ? 0.55 : 0.4) ? pick(["C(=O)NC", "C(=O)NCC"]) : "C(=O)N";
      break;
    case "nitrile":
      skeleton.tail = "C#N";
      break;
    default:
      break;
  }

  if (enabled.has("branched") || bs) {
    const count =
      difficulty === "easy"
        ? chance(0.6)
          ? 1
          : 0
        : difficulty === "medium"
          ? 1
          : difficulty === "hard"
            ? 1 + (chance(0.6) ? 1 : 0)
            : 2 + Math.floor(rng() * 3); // BS: 2–4 branches
    for (let i = 0; i < count; i++) attach(pick(branchPool));
  }
  if ((difficulty === "hard" || bs) && enabled.has("halide") && family !== "halide" && chance(bs ? 0.55 : 0.35)) {
    attach(pick(HALOGENS));
  }
  if ((difficulty !== "easy" || bs) && enabled.has("alkene") && family !== "alkene" && chance(bs ? 0.4 : 0.3)) {
    const options = slots.map((i) => i - 1).filter((i) => i >= 0 && !skeleton.bonds[i]);
    if (options.length) skeleton.bonds[pick(options)] = "=";
  }
  if (bs && enabled.has("alcohol") && family !== "alcohol" && chance(0.3)) attach("O");

  return renderSkeleton(skeleton);
}

/** Flips the drawn geometry of a double bond so cis targets turn up too. */
function maybeFlip(mol: Molecule, rng: Rng): Molecule {
  const g = buildGraph(mol);
  const rings = findRings(g);
  const stereoBonds = mol.bonds.filter((bond) => bondStereo(g, mol, bond, rings.ringAtoms));
  if (!stereoBonds.length || rng() >= 0.5) return mol;
  return reflectAcrossBond(mol, stereoBonds[Math.floor(rng() * stereoBonds.length)].id);
}

export type Challenge = { name: string; molecule: Molecule; smiles: string };

export function randomChallenge(
  difficulty: Difficulty,
  groups: GroupOption[],
  options: { rng?: Rng; avoid?: string } = {},
): Challenge | null {
  const rng = options.rng ?? Math.random;
  const avoid = options.avoid;
  const wanted = groups.length ? groups : DEFAULT_GROUPS;
  const attempts = difficulty === "bs" ? 48 : 80;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const smiles = buildMolecule(wanted, difficulty, rng);
    let molecule: Molecule;
    try {
      molecule = parseSmiles(smiles);
    } catch {
      continue;
    }
    const n = molecule.atoms.length;
    // Skip monsters before the expensive naming pass.
    if (difficulty === "bs" && (n < 6 || n > 22)) continue;
    if (difficulty !== "easy" && difficulty !== "bs" && n < 4) continue;
    if (wanted.includes("cistrans")) molecule = maybeFlip(molecule, rng);
    const result = nameMolecule(molecule);
    if (!result.ok) continue;
    if (result.name === avoid) continue;
    if (wanted.includes("cistrans") && wanted.length <= 2 && !result.analysis.stereo.length) continue;
    return { name: result.name, molecule, smiles };
  }
  return null;
}

export function moleculeFromSmiles(smiles: string): Molecule {
  return parseSmiles(smiles);
}

/* ------------------------------------------------------------------ */
/* Seeded runs                                                         */
/* ------------------------------------------------------------------ */

export type ChallengeMode = "draw" | "name" | "mixed";

export type Question = { kind: "draw" | "name"; challenge: Challenge };

export type RunSetup = {
  seed: string;
  mode: ChallengeMode;
  difficulty: Difficulty;
  groups: GroupOption[];
  count: number;
  /** Casual lets you tweak settings mid-run; strict locks them after start. */
  pace: RunPace;
};

/** The same seed always produces the same questions, so a link can be shared. */
export function buildRun(setup: RunSetup): Question[] {
  const rng = rngFor(
    `${setup.seed}|${setup.mode}|${setup.difficulty}|${setup.count}|${setup.groups.join()}|${setup.pace}`,
  );
  const questions: Question[] = [];
  let previous: string | undefined;
  for (let i = 0; i < setup.count; i++) {
    const challenge = randomChallenge(setup.difficulty, setup.groups, { rng, avoid: previous });
    if (!challenge) continue;
    previous = challenge.name;
    const kind: "draw" | "name" =
      setup.mode === "mixed" ? (rng() < 0.5 ? "draw" : "name") : setup.mode;
    questions.push({ kind, challenge });
  }
  return questions;
}

export { makeSeed };
