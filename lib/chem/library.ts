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
  { label: "pent-trans-2-ene", smiles: "CC=CCC" },
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
const BS_BRANCHES = [
  "C",
  "CC",
  "C(C)C",
  "CCC",
  "C(C)(C)C",
  "CC(C)C",
  "CCC(C)C",
  "C(CC)C",
  "CCCC",
  "C(C)CC",
  "CC(C)(C)C",
];
const HALOGENS = ["Cl", "Br", "F", "I"];

/** How many extra selected features to slam onto the primary one. */
function featureBudget(difficulty: Difficulty, available: number): number {
  if (available <= 0) return 0;
  switch (difficulty) {
    case "easy":
      return Math.min(available, 0); // primary only
    case "medium":
      return Math.min(available, 1);
    case "hard":
      return Math.min(available, 2 + (available > 2 ? 1 : 0));
    case "bs":
      return available; // use everything they checked
  }
}

/** Principal-group seniority — only one of these can own the suffix. */
const PCG_ORDER: GroupOption[] = [
  "acid",
  "ester",
  "amide",
  "nitrile",
  "aldehyde",
  "ketone",
  "alcohol",
  "amine",
];

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

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildMolecule(groups: GroupOption[], difficulty: Difficulty, rng: Rng): string {
  const pick: Pick = (items) => items[Math.floor(rng() * items.length)];
  const chance = (p: number) => rng() < p;
  const enabled = new Set(groups);
  const bs = difficulty === "bs";
  const families = groups.filter((id) => id !== "branched" && id !== "cistrans");

  // Prefer a real principal group when several are selected, so stacking prefixes makes sense.
  const pcgChoices = PCG_ORDER.filter((id) => enabled.has(id));
  const chainFamilies = families.filter((id) => id !== "ring" && id !== "benzene");
  let family: GroupOption | "branched" = chainFamilies.length
    ? pick(chainFamilies)
    : families.length
      ? pick(families)
      : "branched";
  if (pcgChoices.length && (bs || chance(difficulty === "easy" ? 0.55 : 0.75))) {
    // Acid/ester/amide get brittle under BS stacking — prefer ketone/alcohol/amine.
    const preferred = bs
      ? (["ketone", "alcohol", "amine", "aldehyde"] as GroupOption[]).filter((id) => enabled.has(id))
      : pcgChoices;
    family = pick(preferred.length ? preferred : pcgChoices);
  }
  // BS almost never takes the easy ring-template path — chains get stupider.
  if (
    !bs &&
    enabled.has("cistrans") &&
    !["ring", "benzene"].includes(family) &&
    chance(0.55)
  ) {
    family = "alkene";
  }
  if (bs && enabled.has("cistrans") && chance(0.85)) {
    family = "alkene";
  }
  if (bs && (family === "ring" || family === "benzene") && chainFamilies.length) {
    family = pick(chainFamilies);
  }

  // Simple ring templates only on easy/medium — hard/BS decorate or skip them.
  const template = RING_TEMPLATES[family as GroupOption];
  if (template && !bs && difficulty !== "hard" && chance(0.35)) {
    const onBenzene = enabled.has("benzene") && template.benzene;
    const onRing = enabled.has("ring") && template.ring;
    const base = onBenzene && (!onRing || chance(0.5)) ? template.benzene : onRing ? template.ring : null;
    if (base) return base;
  }

  let size =
    difficulty === "easy"
      ? 3 + Math.floor(rng() * 2)
      : difficulty === "medium"
        ? 4 + Math.floor(rng() * 3)
        : difficulty === "hard"
          ? 5 + Math.floor(rng() * 4)
          : 8 + Math.floor(rng() * 5); // BS: 8–12
  if (enabled.has("cistrans") && family === "alkene") size = Math.max(size, 4);
  if (bs) size = Math.max(size, 8);

  const branchPool = bs || difficulty === "hard" ? BS_BRANCHES : BRANCHES;

  if (family === "benzene" || family === "ring") {
    const ringSmiles =
      family === "benzene" ? "C1(@)=CC=CC=C1" : pick(["C1(@)CCCCC1", "C1(@)CCCC1", "C1(@)CCCCCCC1"]);
    const bits: string[] = [];
    const branch = enabled.has("branched") || bs ? pick(branchPool) : "C";
    bits.push(branch);
    const extras =
      difficulty === "easy"
        ? 0
        : difficulty === "medium"
          ? chance(0.5)
            ? 1
            : 0
          : difficulty === "hard"
            ? 1 + (chance(0.5) ? 1 : 0)
            : 3 + Math.floor(rng() * 3);
    const ringExtras = shuffle(
      [
        ...(enabled.has("branched") || bs ? branchPool : []),
        ...(enabled.has("halide") ? HALOGENS : []),
        ...(enabled.has("alcohol") ? ["O"] : []),
        ...(enabled.has("amine") ? ["N"] : []),
        ...(enabled.has("ether") ? ["OC", "OCC"] : []),
      ],
      rng,
    );
    for (let i = 0; i < extras && i < ringExtras.length; i++) bits.push(ringExtras[i]);
    return ringSmiles.replace("@", bits[0] ?? "C") + bits.slice(1).map((b) => `(${b})`).join("");
  }

  const skeleton = emptySkeleton(size);
  const slots = innerSlots(size);
  const attach = (value: string) => {
    const places = slots.length ? slots : [0];
    // Spread load — overloaded carbons are why BS used to mostly fail naming.
    let best = places[0];
    let bestScore = Infinity;
    for (const i of places) {
      const score = skeleton.slots[i].length * 3 + (i === 0 || i === size - 1 ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    skeleton.slots[best].push(value);
  };

  const freeBondSlots = () =>
    Array.from({ length: Math.max(size - 1, 0) }, (_, i) => i).filter((i) => !skeleton.bonds[i]);
  /** Prefer non-adjacent double bonds so we don't invent allenes the namer hates. */
  const placeAlkene = (preferInternal = false) => {
    let free = freeBondSlots().filter((i) => {
      if (i > 0 && skeleton.bonds[i - 1] === "=") return false;
      if (i < size - 2 && skeleton.bonds[i + 1] === "=") return false;
      return true;
    });
    if (preferInternal) {
      const internal = free.filter((i) => i > 0 && i < size - 2);
      if (internal.length) free = internal;
    }
    const pool = free.length ? free : freeBondSlots();
    if (!pool.length) return;
    skeleton.bonds[pick(pool)] = "=";
  };

  const applyFamily = (id: GroupOption | "branched") => {
    switch (id) {
      case "alkene":
        placeAlkene(enabled.has("cistrans"));
        break;
      case "alkyne": {
        const options = freeBondSlots().filter((i) => i === 0 || i === size - 2);
        const at = options.length ? pick(options) : 0;
        if (!skeleton.bonds[at]) skeleton.bonds[at] = "#";
        break;
      }
      case "halide":
        attach(pick(HALOGENS));
        break;
      case "alcohol":
        attach("O");
        break;
      case "ether":
        attach(pick(bs ? ["OC", "OCC", "OC(C)C"] : ["OC", "OCC"]));
        break;
      case "amine":
        attach(bs && chance(0.45) ? pick(["N", "NC"]) : "N");
        break;
      case "ketone":
        if (!skeleton.slots.some((s) => s.includes("=O"))) attach("=O");
        break;
      case "aldehyde":
        if (!skeleton.tail) skeleton.tail = "C=O";
        break;
      case "acid":
        if (!skeleton.tail) skeleton.tail = "C(=O)O";
        break;
      case "ester":
        if (!skeleton.tail) {
          skeleton.tail = `C(=O)O${pick(bs ? ["C", "CC", "CCC", "C(C)C"] : ["C", "CC", "CCC"])}`;
        }
        break;
      case "amide":
        if (!skeleton.tail) {
          skeleton.tail = chance(bs ? 0.65 : 0.4) ? pick(["C(=O)NC", "C(=O)NCC"]) : "C(=O)N";
        }
        break;
      case "nitrile":
        if (!skeleton.tail) skeleton.tail = "C#N";
        break;
      default:
        break;
    }
  };

  applyFamily(family);

  // Stack more of the user's selections onto the same structure.
  const stackable = shuffle(
    families.filter((id) => {
      if (id === family) return false;
      if (skeleton.tail && ["aldehyde", "acid", "ester", "amide", "nitrile"].includes(id)) return false;
      if (id === "ketone" && skeleton.slots.some((s) => s.includes("=O"))) return false;
      if (id === "ring" || id === "benzene") return false;
      // Alkyne + alkene piles make structures the namer mostly rejects.
      if (id === "alkyne" && (family === "alkene" || enabled.has("alkene"))) return false;
      if (id === "alkene" && family === "alkyne") return false;
      return true;
    }),
    rng,
  );
  const budget = featureBudget(difficulty, stackable.length);
  for (let i = 0; i < budget; i++) applyFamily(stackable[i]);

  // BS: pile on the chaos, but keep it chemically nameable.
  if (bs) {
    if (enabled.has("halide")) {
      attach(pick(HALOGENS));
      if (chance(0.8)) attach(pick(HALOGENS));
    }
    if (enabled.has("alcohol") && family !== "alcohol") attach("O");
    if (enabled.has("alkene") && family !== "alkyne") {
      placeAlkene(enabled.has("cistrans"));
      if (chance(0.65)) placeAlkene(false);
    }
    if (enabled.has("ether") && chance(0.55)) attach(pick(["OC", "OCC"]));
    if (enabled.has("amine") && family !== "amine" && chance(0.5)) attach("N");
  } else if (difficulty === "hard") {
    if (enabled.has("halide") && family !== "halide" && chance(0.45)) attach(pick(HALOGENS));
    if (enabled.has("alkene") && family !== "alkene" && chance(0.35)) placeAlkene();
  } else if (difficulty === "medium") {
    if (enabled.has("halide") && family !== "halide" && chance(0.25)) attach(pick(HALOGENS));
  }

  if (enabled.has("branched") || bs) {
    const count =
      difficulty === "easy"
        ? chance(0.55)
          ? 1
          : 0
        : difficulty === "medium"
          ? 1 + (chance(0.35) ? 1 : 0)
          : difficulty === "hard"
            ? 2 + (chance(0.5) ? 1 : 0)
            : 3 + Math.floor(rng() * 3); // BS: 3–5 wild branches
    for (let i = 0; i < count; i++) attach(pick(branchPool));
  }

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
  const attempts = difficulty === "bs" ? 160 : 80;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const smiles = buildMolecule(wanted, difficulty, rng);
    let molecule: Molecule;
    try {
      molecule = parseSmiles(smiles);
    } catch {
      continue;
    }
    const n = molecule.atoms.length;
    if (difficulty === "bs" && (n < 8 || n > 34)) continue;
    if (difficulty === "hard" && n < 6) continue;
    if (difficulty === "medium" && n < 4) continue;
    if (wanted.includes("cistrans")) molecule = maybeFlip(molecule, rng);
    const result = nameMolecule(molecule);
    if (!result.ok) continue;
    if (result.name === avoid) continue;
    if (wanted.includes("cistrans") && wanted.length <= 2 && !result.analysis.stereo.length) continue;
    // Prefer long ridiculous BS names; loosen late so the run still fills.
    const minName = attempt < 80 ? 22 : 14;
    if (difficulty === "bs" && result.name.length < minName) continue;
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
    let challenge: Challenge | null = null;
    for (let tryN = 0; tryN < 4 && !challenge; tryN++) {
      challenge = randomChallenge(setup.difficulty, setup.groups, { rng, avoid: previous });
    }
    if (!challenge) continue;
    previous = challenge.name;
    const kind: "draw" | "name" =
      setup.mode === "mixed" ? (rng() < 0.5 ? "draw" : "name") : setup.mode;
    questions.push({ kind, challenge });
  }
  return questions;
}

export { makeSeed };
