import { HALOGEN_PREFIX, isHalogen } from "./elements";
import {
  bondBetween,
  bondsWithin,
  buildGraph,
  carbonNeighbors,
  collectBranch,
  compareNumbers,
  components,
  element,
  findRings,
  isCarbon,
  neighbors,
  pathBetween,
  valence,
  type Graph,
  type RingInfo,
} from "./graph";
import { MAX_VALENCE } from "./elements";
import { findGroups, principalKind, GROUP_LABEL, type Group, type GroupKind } from "./groups";
import {
  alphaKey,
  assembleParent,
  complexMultiplier,
  joinName,
  multiplier,
  stem,
  type NameStyle,
  type SuffixToken,
} from "./roots";
import { bondStereo, type Stereo } from "./stereo";
import type { Molecule } from "./types";

export type ParentKind = "chain" | "ring" | "benzene";

/**
 * Puts cis/trans immediately before the locant it belongs to — the high-school
 * form: but-cis-2-ene, cis-2-butene, hexa-trans-2,cis-4-diene.
 */
export function embedStereo(parent: string, stereo: Stereo[], eneLocants: number[]): string {
  if (!stereo.length || !eneLocants.length) return parent;
  const byLocant = new Map(stereo.map((s) => [s.locant, s.descriptor]));
  const plain = eneLocants.join(",");
  const tagged = eneLocants
    .map((loc) => {
      const descriptor = byLocant.get(loc);
      return descriptor ? `${descriptor}-${loc}` : String(loc);
    })
    .join(",");
  if (tagged === plain) return parent;

  const leading = new RegExp(`^${plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=-)`);
  if (leading.test(parent)) return parent.replace(leading, tagged);

  const mid = `-${plain}-`;
  const at = parent.indexOf(mid);
  if (at >= 0) {
    return `${parent.slice(0, at)}-${tagged}-${parent.slice(at + mid.length)}`;
  }

  // Fallback if the locant run isn't a clean block (shouldn't happen often).
  const single = stereo.length === 1 && eneLocants.length === 1;
  const prefix = single
    ? `${stereo[0].descriptor}-`
    : `${stereo.map((s) => `${s.descriptor}-${s.locant}`).join(",")}-`;
  return prefix + parent;
}

export type Locant = number | "N";

export type Substituent = {
  locant: Locant;
  name: string;
  alpha: string;
  complex: boolean;
  carbons: number;
  atoms: string[];
  bonds: string[];
  attach: string;
  root: string;
};

export type SubstituentGroup = {
  name: string;
  alpha: string;
  complex: boolean;
  locants: Locant[];
  text: string;
  atoms: string[];
  bonds: string[];
};

export type Criterion =
  | "only"
  | "group"
  | "unsaturation"
  | "length"
  | "count"
  | "groupLocants"
  | "unsatLocants"
  | "eneLocants"
  | "subLocants"
  | "alphabet";

export type Analysis = {
  kind: ParentKind;
  atoms: string[];
  bonds: string[];
  length: number;
  eneLocants: number[];
  yneLocants: number[];
  eneBonds: string[];
  yneBonds: string[];
  pcg: GroupKind | null;
  pcgLabel: string | null;
  pcgLocants: number[];
  pcgAtoms: string[];
  pcgBonds: string[];
  suffixLabel: string | null;
  substituents: Substituent[];
  groups: SubstituentGroup[];
  esterWord: string | null;
  stereo: Stereo[];
  parent: string;
  name: string;
  numbers: Record<string, number>;
  ringCount: number;
  chainAlternative?: { length: number; unsaturations: number; substituents: number };
  parentCriterion: Criterion;
  numberingCriterion: Criterion;
  reversed: { eneLocants: number[]; yneLocants: number[]; subLocants: number[]; pcgLocants: number[] };
};

export type NameResult =
  | { ok: true; name: string; formula: string; analysis: Analysis }
  | { ok: false; kind: "empty" | "error"; error: string; atoms?: string[]; bonds?: string[] };

export type NameOptions = {
  style?: NameStyle;
  /** false spells isopropyl as propan-2-yl, tert-butyl as 2-methylpropan-2-yl, … */
  commonAlkyl?: boolean;
  /** true keeps locants that are normally left out: ethan-1-ol, 1-methylcyclohexane. */
  keepLocants?: boolean;
};

type BranchName = Omit<Substituent, "locant" | "attach" | "root">;

type Context = {
  g: Graph;
  rings: RingInfo;
  groups: Group[];
  style: NameStyle;
  commonAlkyl: boolean;
  /** Carbons the parent has to contain (they carry the principal group). */
  anchors: Set<string>;
  /** Atoms already spoken for by the suffix — they never become prefixes. */
  suffixAtoms: Set<string>;
  cache: Map<string, BranchName>;
};

type Candidate = {
  order: string[];
  cyclic: boolean;
  aromatic: boolean;
  eneLocants: number[];
  yneLocants: number[];
  unsatLocants: number[];
  pcgLocants: number[];
  subs: Substituent[];
  subLocants: number[];
  alphaLocants: number[];
};

const KEY_ORDER: Criterion[] = [
  "group",
  "unsaturation",
  "length",
  "count",
  "groupLocants",
  "unsatLocants",
  "eneLocants",
  "subLocants",
  "alphabet",
];

function keys(c: Candidate): number[][] {
  return [
    [-c.pcgLocants.length],
    [-(c.eneLocants.length + c.yneLocants.length)],
    [-c.order.length],
    [-c.subs.length],
    c.pcgLocants,
    c.unsatLocants,
    c.eneLocants,
    c.subLocants,
    c.alphaLocants,
  ];
}

function firstDifference(a: Candidate, b: Candidate): number {
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) if (compareNumbers(ka[i], kb[i]) !== 0) return i;
  return -1;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) {
    const d = compareNumbers(ka[i], kb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

function isAromaticRing(g: Graph, ring: string[]): boolean {
  if (ring.length !== 6) return false;
  const orders: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const bond = bondBetween(g, ring[i], ring[(i + 1) % ring.length]);
    if (!bond) return false;
    orders.push(bond.order);
  }
  if (orders.filter((o) => o === 2).length !== 3) return false;
  return orders.every((o, i) => o !== orders[(i + 1) % orders.length]);
}

const numericLocants = (subs: Substituent[]) =>
  subs.filter((s) => typeof s.locant === "number").map((s) => s.locant as number);

/* ------------------------------------------------------------------ */
/* Substituents                                                        */
/* ------------------------------------------------------------------ */

function analyseSubstituents(ctx: Context, order: string[], blocked: Set<string>): Substituent[] {
  const parentSet = new Set([...order, ...blocked]);
  const subs: Substituent[] = [];
  order.forEach((atomId, index) => {
    for (const n of neighbors(ctx.g, atomId)) {
      if (parentSet.has(n.atom) || ctx.suffixAtoms.has(n.atom)) continue;
      const cacheId = `${atomId}>${n.atom}|${[...parentSet].sort().join()}`;
      let described = ctx.cache.get(cacheId);
      if (!described) {
        described = describeBranch(ctx, parentSet, n.atom, n.bond.order);
        ctx.cache.set(cacheId, described);
      }
      subs.push({
        ...described,
        bonds: [...described.bonds, n.bond.id],
        locant: index + 1,
        attach: atomId,
        root: n.atom,
      });
    }
  });
  return subs;
}

function buildCandidate(ctx: Context, order: string[], cyclic: boolean, blocked = new Set<string>()): Candidate {
  const eneLocants: number[] = [];
  const yneLocants: number[] = [];
  const pairs = cyclic ? order.length : order.length - 1;
  for (let i = 0; i < pairs; i++) {
    const bond = bondBetween(ctx.g, order[i], order[(i + 1) % order.length]);
    if (!bond) continue;
    if (bond.order === 2) eneLocants.push(i + 1);
    if (bond.order === 3) yneLocants.push(i + 1);
  }
  const aromatic = cyclic && isAromaticRing(ctx.g, order);
  if (aromatic) {
    eneLocants.length = 0;
    yneLocants.length = 0;
  }
  const subs = analyseSubstituents(ctx, order, blocked);
  const subLocants = numericLocants(subs).sort((a, b) => a - b);
  const alphaLocants = [...subs]
    .sort((a, b) => (a.alpha === b.alpha ? 0 : a.alpha.localeCompare(b.alpha)))
    .map((s) => (typeof s.locant === "number" ? s.locant : 0));
  const pcgLocants = order
    .map((id, i) => (ctx.anchors.has(id) ? i + 1 : 0))
    .filter((locant) => locant > 0);

  return {
    order,
    cyclic,
    aromatic,
    eneLocants,
    yneLocants,
    unsatLocants: [...eneLocants, ...yneLocants].sort((a, b) => a - b),
    pcgLocants,
    subs,
    subLocants,
    alphaLocants,
  };
}

const COMMON_ALKYL: Record<string, string> = {
  "2|1:methyl": "isopropyl",
  "2|1:methyl,1:methyl": "tert-butyl",
  "3|1:methyl": "sec-butyl",
  "3|2:methyl": "isobutyl",
  "3|1:methyl,1:methyl": "tert-pentyl",
  "3|2:methyl,2:methyl": "neopentyl",
  "4|3:methyl": "isopentyl",
};

const ALKOXY: Record<string, string> = {
  methyl: "methoxy",
  ethyl: "ethoxy",
  propyl: "propoxy",
  butyl: "butoxy",
  isopropyl: "isopropoxy",
  "tert-butyl": "tert-butoxy",
  phenyl: "phenoxy",
};

/** Names whatever hangs off the parent at `root`, numbering its own C1 at the join. */
function describeBranch(ctx: Context, blocked: Set<string>, root: string, joinOrder = 1): BranchName {
  const { g, rings, style } = ctx;
  const el = element(g, root);
  const branchAtoms = collectBranch(g, root, blocked);
  const allBonds = bondsWithin(g, branchAtoms);
  const wrap = (name: string, complex = false): BranchName => ({
    name,
    alpha: alphaKey(name),
    complex,
    atoms: branchAtoms,
    bonds: allBonds,
    carbons: branchAtoms.filter((id) => isCarbon(g, id)).length,
  });

  if (isHalogen(el)) return wrap(HALOGEN_PREFIX[el]);

  if (el === "O") {
    if (joinOrder === 2) return wrap("oxo");
    const others = neighbors(g, root).filter((n) => !blocked.has(n.atom));
    if (!others.length) return wrap("hydroxy");
    const alkyl = describeBranch(ctx, new Set([...blocked, root]), others[0].atom);
    const alkoxy = ALKOXY[alkyl.name] ?? `${alkyl.name}oxy`;
    return wrap(alkoxy, alkyl.complex);
  }

  if (el === "N") {
    const others = neighbors(g, root).filter((n) => !blocked.has(n.atom));
    if (!others.length) return wrap("amino");
    const names = others
      .map((n) => describeBranch(ctx, new Set([...blocked, root]), n.atom).name)
      .sort();
    const label =
      names.length === 1
        ? `${names[0]}amino`
        : names[0] === names[1]
          ? `di${names[0]}amino`
          : `${names.join("")}amino`;
    return wrap(label, true);
  }

  // carbon branches that are themselves a functional group get their own prefix name
  const anchored = ctx.groups.filter((group) => group.anchor === root);
  const carbonyl = anchored.find((group) =>
    ["acid", "ester", "amide", "nitrile", "aldehyde"].includes(group.kind),
  );
  if (carbonyl && branchAtoms.every((id) => id === root || !isCarbon(g, id))) {
    if (carbonyl.kind === "acid") return wrap("carboxy");
    if (carbonyl.kind === "nitrile") return wrap("cyano");
    if (carbonyl.kind === "aldehyde") return wrap("formyl");
    if (carbonyl.kind === "amide") return wrap("carbamoyl");
  }
  if (carbonyl?.kind === "ester" && carbonyl.esterCarbon) {
    const alkyl = describeBranch(ctx, new Set([...blocked, root, carbonyl.esterOxygen!]), carbonyl.esterCarbon);
    const alkoxy = ALKOXY[alkyl.name] ?? `${alkyl.name}oxy`;
    return wrap(`${alkoxy}carbonyl`, true);
  }

  const ring = rings.rings.find((r) => r.includes(root) && r.every((id) => branchAtoms.includes(id)));
  if (ring) return { ...wrap("", false), ...nameRingSubstituent(ctx, blocked, ring, root), atoms: branchAtoms, bonds: allBonds, carbons: branchAtoms.filter((id) => isCarbon(g, id)).length };

  const openAtoms = branchAtoms.filter((id) => isCarbon(g, id) && !rings.ringAtoms.has(id));
  const openSet = new Set(openAtoms);
  const candidates: Candidate[] = [];
  for (const target of openAtoms) {
    const path = pathBetween(g, root, target, openSet);
    if (path) candidates.push(buildCandidate(ctx, path, false, blocked));
  }
  if (!candidates.length) return wrap("?");
  candidates.sort(compareCandidates);
  const best = candidates[0];

  const groups = groupSubstituents(best.subs);
  const prefixes = groups.map((gr) => gr.text);
  const signature = `${best.order.length}|${[...best.subs].map((s) => `${s.locant}:${s.name}`).sort().join(",")}`;
  const unsaturated = best.eneLocants.length > 0 || best.yneLocants.length > 0;
  const common = !unsaturated && ctx.commonAlkyl ? COMMON_ALKYL[signature] : undefined;
  if (common) return wrap(common);

  let body: string;
  if (unsaturated && best.order.length === 2) {
    body = best.eneLocants.length ? "ethenyl" : "ethynyl";
  } else if (unsaturated) {
    const tokens: SuffixToken[] = [];
    if (best.eneLocants.length) {
      tokens.push({
        locants: best.eneLocants,
        label: `${multiplier(best.eneLocants.length)}ene`,
        showLocants: true,
      });
    }
    if (best.yneLocants.length) {
      tokens.push({
        locants: best.yneLocants,
        label: `${multiplier(best.yneLocants.length)}yne`,
        showLocants: true,
      });
    }
    body = `${assembleParent({ stem: stem(best.order.length), tokens, style: "modern" }).replace(/e$/, "")}-1-yl`;
  } else {
    body = `${stem(best.order.length)}yl`;
  }
  const name = joinName(prefixes, body);
  const complex = prefixes.length > 0 || (unsaturated && best.order.length > 2);
  const finished = joinOrder > 1 ? ylidene(name, joinOrder, style) : name;
  return wrap(finished, complex);
}

/** A group joined to the parent by a double or triple bond is an -ylidene / -ylidyne. */
function ylidene(name: string, order: number, style: NameStyle): string {
  const ending = order === 3 ? "ylidyne" : "ylidene";
  const out = name.replace(/yl$/, ending);
  return style === "classic" && out === "methylidene" ? "methylene" : out;
}

function nameRingSubstituent(
  ctx: Context,
  blocked: Set<string>,
  ring: string[],
  root: string,
): Pick<BranchName, "name" | "alpha" | "complex"> {
  const start = ring.indexOf(root);
  const forward = [...ring.slice(start), ...ring.slice(0, start)];
  const orders = [forward, [forward[0], ...forward.slice(1).reverse()]];
  const candidates = orders.map((order) => buildCandidate(ctx, order, true, blocked));
  candidates.sort(compareCandidates);
  const best = candidates[0];

  if (best.aromatic && best.subs.length === 0) return { name: "phenyl", alpha: "phenyl", complex: false };
  const groups = groupSubstituents(best.subs);
  const prefixes = groups.map((gr) => gr.text);
  const body = best.aromatic
    ? "phenyl"
    : best.eneLocants.length || best.yneLocants.length
      ? `${assembleParent({
          stem: `cyclo${stem(ring.length)}`,
          tokens: [
            ...(best.eneLocants.length
              ? [{ locants: best.eneLocants, label: `${multiplier(best.eneLocants.length)}ene`, showLocants: true }]
              : []),
            ...(best.yneLocants.length
              ? [{ locants: best.yneLocants, label: `${multiplier(best.yneLocants.length)}yne`, showLocants: true }]
              : []),
          ],
          style: "modern",
        }).replace(/e$/, "")}-1-yl`
      : `cyclo${stem(ring.length)}yl`;
  const name = joinName(prefixes, body);
  return { name, alpha: alphaKey(name), complex: prefixes.length > 0 };
}

export function groupSubstituents(subs: Substituent[]): SubstituentGroup[] {
  const byName = new Map<string, Substituent[]>();
  for (const s of subs) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  const groups: SubstituentGroup[] = [];
  for (const [name, list] of byName) {
    // italic N locants are cited before numerals: N,3-dimethylbutanamide
    const rank = (locant: Locant) => (locant === "N" ? -1 : locant);
    const locants = list.map((s) => s.locant).sort((a, b) => Number(rank(a)) - Number(rank(b)));
    const complex = list[0].complex;
    const count = list.length;
    const prefix = count === 1 ? "" : complex ? complexMultiplier(count) : multiplier(count);
    const label = complex ? `${prefix}(${name})` : `${prefix}${name}`;
    groups.push({
      name,
      alpha: list[0].alpha,
      complex,
      locants,
      text: `${locants.join(",")}-${label}`,
      atoms: list.flatMap((s) => s.atoms),
      bonds: list.flatMap((s) => s.bonds),
    });
  }
  groups.sort((a, b) => {
    if (a.alpha !== b.alpha) return a.alpha.localeCompare(b.alpha);
    const value = (locant: Locant) => (locant === "N" ? -1 : locant);
    return Number(value(a.locants[0])) - Number(value(b.locants[0]));
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/* Suffixes                                                            */
/* ------------------------------------------------------------------ */

const CARBO_SUFFIX: Partial<Record<GroupKind, { ring: string; benzene: string }>> = {
  acid: { ring: "carboxylic acid", benzene: "benzoic acid" },
  amide: { ring: "carboxamide", benzene: "benzamide" },
  nitrile: { ring: "carbonitrile", benzene: "benzonitrile" },
  aldehyde: { ring: "carbaldehyde", benzene: "benzaldehyde" },
  ester: { ring: "carboxylate", benzene: "benzoate" },
};

const TERMINAL_SUFFIX: GroupKind[] = ["acid", "ester", "amide", "nitrile", "aldehyde"];

function suffixLabel(kind: GroupKind, count: number, carbo: boolean): string {
  if (carbo) {
    const base = CARBO_SUFFIX[kind]!.ring;
    return count > 1 ? `${multiplier(count)}${base}` : base;
  }
  switch (kind) {
    case "acid":
      return count > 1 ? "dioic acid" : "oic acid";
    case "ester":
      return count > 1 ? "dioate" : "oate";
    case "amide":
      return count > 1 ? "diamide" : "amide";
    case "nitrile":
      return count > 1 ? "dinitrile" : "nitrile";
    case "aldehyde":
      return count > 1 ? "dial" : "al";
    case "ketone":
      return `${multiplier(count)}one`;
    case "alcohol":
      return `${multiplier(count)}ol`;
    case "amine":
      return `${multiplier(count)}amine`;
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function nameMolecule(mol: Molecule, options: NameOptions = {}): NameResult {
  const style = options.style ?? "modern";
  const keepLocants = options.keepLocants ?? false;
  const g = buildGraph(mol);

  if (mol.atoms.length === 0) {
    return { ok: false, kind: "empty", error: "Draw a structure to see its name." };
  }

  const parts = components(g);
  if (parts.length > 1) {
    return {
      ok: false,
      kind: "error",
      error: `There are ${parts.length} separate pieces — join them into one molecule.`,
      atoms: parts.slice(1).flat(),
    };
  }

  const overloaded = g.ids.filter((id) => valence(g, id) > MAX_VALENCE[element(g, id)]);
  if (overloaded.length) {
    return {
      ok: false,
      kind: "error",
      error: `${element(g, overloaded[0])} can only make ${MAX_VALENCE[element(g, overloaded[0])]} bond(s) — the highlighted atom has too many.`,
      atoms: overloaded,
    };
  }

  const rings = findRings(g);
  if (rings.fused) {
    return {
      ok: false,
      kind: "error",
      error: "Fused, bridged and spiro ring systems aren't supported yet.",
      atoms: [...rings.ringAtoms],
    };
  }
  const heteroRing = rings.rings.find((ring) => ring.some((id) => !isCarbon(g, id)));
  if (heteroRing) {
    return {
      ok: false,
      kind: "error",
      error: "Rings with an oxygen or nitrogen in them aren't supported yet.",
      atoms: heteroRing,
    };
  }

  const groups = findGroups(g);
  const pcg = principalKind(groups);
  const pcgGroups = groups.filter((group) => group.kind === pcg);

  // -COOH / -CHO / -CN / -CONH2 hanging off a ring keep the ring as the parent
  let carbo = false;
  let anchorList = pcgGroups.map((group) => group.anchor);
  if (pcg && CARBO_SUFFIX[pcg] && rings.rings.length) {
    const ringAnchors = pcgGroups.map((group) => {
      const carbons = carbonNeighbors(g, group.anchor);
      return carbons.length === 1 && rings.ringAtoms.has(carbons[0].atom) ? carbons[0].atom : null;
    });
    if (ringAnchors.every((id): id is string => id !== null)) {
      carbo = true;
      anchorList = ringAnchors;
    }
  }
  const anchorOf = (group: Group) =>
    carbo ? (carbonNeighbors(g, group.anchor)[0]?.atom ?? group.anchor) : group.anchor;

  const ctx: Context = {
    g,
    rings,
    groups,
    style,
    commonAlkyl: options.commonAlkyl ?? true,
    anchors: new Set(anchorList),
    suffixAtoms: new Set(),
    cache: new Map(),
  };

  /** Atoms the suffix swallows for a given parent skeleton. */
  const suffixAtomsFor = (order: string[]) => {
    const inParent = new Set(order);
    const out = new Set<string>();
    for (const group of pcgGroups) {
      if (!inParent.has(anchorOf(group))) continue;
      group.atoms.forEach((id) => out.add(id));
      if (carbo) out.add(group.anchor);
      if (group.esterOxygen) {
        collectBranch(g, group.esterOxygen, new Set([group.anchor])).forEach((id) => out.add(id));
      }
      if (group.nitrogen) {
        collectBranch(g, group.nitrogen, new Set([group.anchor])).forEach((id) => out.add(id));
      }
    }
    return out;
  };

  const parentCandidate = (order: string[], cyclic: boolean) => {
    ctx.suffixAtoms = suffixAtomsFor(order);
    return buildCandidate(ctx, order, cyclic);
  };

  const carbons = g.ids.filter((id) => isCarbon(g, id));
  const openAtoms = carbons.filter((id) => !rings.ringAtoms.has(id));
  const openSet = new Set(openAtoms);

  const chainCandidates: Candidate[] = [];
  for (let i = 0; i < openAtoms.length; i++) {
    for (let j = i; j < openAtoms.length; j++) {
      const path = pathBetween(g, openAtoms[i], openAtoms[j], openSet);
      if (!path) continue;
      chainCandidates.push(parentCandidate(path, false));
      if (path.length > 1) chainCandidates.push(parentCandidate([...path].reverse(), false));
    }
  }
  chainCandidates.sort(compareCandidates);

  const carbonRings = rings.rings.filter((ring) => ring.every((id) => isCarbon(g, id)));
  const ringCandidates: Candidate[] = [];
  for (const ring of carbonRings) {
    for (let start = 0; start < ring.length; start++) {
      const forward = [...ring.slice(start), ...ring.slice(0, start)];
      ringCandidates.push(parentCandidate(forward, true));
      ringCandidates.push(parentCandidate([forward[0], ...forward.slice(1).reverse()], true));
    }
  }
  ringCandidates.sort(compareCandidates);

  const bestChain = chainCandidates[0];
  const bestRing = ringCandidates[0];
  const longestChain = chainCandidates.reduce((max, c) => Math.max(max, c.order.length), 0);

  let useRing = false;
  if (bestRing) {
    if (!bestChain) useRing = true;
    else if (bestRing.pcgLocants.length !== bestChain.pcgLocants.length) {
      useRing = bestRing.pcgLocants.length > bestChain.pcgLocants.length;
    } else {
      useRing = bestRing.order.length >= longestChain;
    }
  }

  const best = useRing ? bestRing : bestChain;
  ctx.suffixAtoms = suffixAtomsFor(best.order);

  const reverse = useRing
    ? parentCandidate([best.order[0], ...best.order.slice(1).reverse()], true)
    : parentCandidate([...best.order].reverse(), false);
  const numberingDiff = firstDifference(reverse, best);
  const numberingCriterion: Criterion = numberingDiff >= 0 ? KEY_ORDER[numberingDiff] : "only";

  let parentCriterion: Criterion = "only";
  let chainAlternative: Analysis["chainAlternative"];
  const bestSet = new Set(best.order);
  const pool = useRing ? [...ringCandidates, ...chainCandidates] : chainCandidates;
  const other = pool.find(
    (c) => c.order.length !== best.order.length || !c.order.every((id) => bestSet.has(id)),
  );
  if (other) {
    const diff = firstDifference(other, best);
    parentCriterion = diff >= 0 ? KEY_ORDER[diff] : "only";
    chainAlternative = {
      length: other.order.length,
      unsaturations: other.eneLocants.length + other.yneLocants.length,
      substituents: other.subs.length,
    };
  }
  ctx.suffixAtoms = suffixAtomsFor(best.order);

  /* ---- suffix, N-substituents and the ester word ---- */
  const parentAtoms = new Set(best.order);
  const activeGroups = pcgGroups.filter((group) => parentAtoms.has(anchorOf(group)));
  const suffixCount = activeGroups.length;
  const hasSuffix = pcg !== null && suffixCount > 0;

  const nSubs: Substituent[] = [];
  let esterWord: string | null = null;
  const maskedAtoms = ctx.suffixAtoms;
  ctx.suffixAtoms = new Set();
  for (const group of activeGroups) {
    if (group.kind === "ester" && group.esterCarbon) {
      const named = describeBranch(ctx, new Set([group.anchor, group.esterOxygen!]), group.esterCarbon);
      esterWord = named.complex ? `(${named.name})` : named.name;
    }
    if ((group.kind === "amide" || group.kind === "amine") && group.nitrogen) {
      for (const n of neighbors(g, group.nitrogen)) {
        if (n.atom === group.anchor) continue;
        const named = describeBranch(ctx, new Set([group.nitrogen]), n.atom);
        nSubs.push({
          ...named,
          bonds: [...named.bonds, n.bond.id],
          locant: "N",
          attach: group.nitrogen,
          root: n.atom,
        });
      }
    }
  }
  ctx.suffixAtoms = maskedAtoms;

  const cyclic = best.cyclic;
  const aromatic = best.aromatic;
  const length = best.order.length;

  const tokens: SuffixToken[] = [];
  if (!aromatic) {
    if (!best.eneLocants.length && !best.yneLocants.length) {
      tokens.push({ locants: [], label: "ane", showLocants: false });
    } else {
      const single = (locants: number[]) =>
        !keepLocants &&
        ((length === 2 && locants.length === 1) ||
        (cyclic && locants.length === 1 && locants[0] === 1 && !hasSuffix && best.subs.length === 0));
      if (best.eneLocants.length) {
        tokens.push({
          locants: best.eneLocants,
          label: `${multiplier(best.eneLocants.length)}ene`,
          showLocants: !single(best.eneLocants),
        });
      }
      if (best.yneLocants.length) {
        tokens.push({
          locants: best.yneLocants,
          label: `${multiplier(best.yneLocants.length)}yne`,
          showLocants: !single(best.yneLocants),
        });
      }
    }
  }

  const suffixLocants = best.pcgLocants;
  let suffixText: string | null = null;
  if (hasSuffix && pcg) {
    const label = suffixLabel(pcg, suffixCount, carbo);
    suffixText = label;
    const terminal = TERMINAL_SUFFIX.includes(pcg) || carbo;
    const hide =
      terminal ||
      (!keepLocants &&
        suffixCount === 1 &&
        (length <= 2 || (cyclic && (best.subs.length === 0 || style === "classic"))));
    tokens.push({ locants: suffixLocants, label, showLocants: !hide });
  }

  /* ---- the parent word ---- */
  let parent: string;
  if (aromatic) {
    if (!hasSuffix || !pcg) parent = "benzene";
    else if (carbo) parent = CARBO_SUFFIX[pcg]!.benzene;
    else if (pcg === "alcohol" && suffixCount === 1) parent = "phenol";
    else if (pcg === "amine" && suffixCount === 1) parent = "aniline";
    else parent = assembleParent({ stem: "benzene", tokens: tokens.slice(-1), style });
  } else {
    parent = assembleParent({
      stem: `${cyclic ? "cyclo" : ""}${stem(length)}`,
      tokens,
      style,
    });
  }

  /* ---- prefixes ---- */
  const prefixGroups = groupSubstituents([...best.subs, ...nSubs]);
  const singleSubstituent = best.subs.length + nSubs.length === 1;
  const hideLocant =
    length === 1 ||
    (!keepLocants &&
      !hasSuffix &&
      singleSubstituent &&
      !best.eneLocants.length &&
      !best.yneLocants.length &&
      (cyclic || length <= 2));
  const prefixes = prefixGroups.map((group) =>
    hideLocant ? group.text.replace(/^[\d,]+-/, "") : group.text,
  );

  /* ---- stereochemistry straight off the drawing ---- */
  const stereo: Stereo[] = [];
  const parentBonds: string[] = [];
  const eneBonds: string[] = [];
  const yneBonds: string[] = [];
  const pairCount = cyclic ? length : length - 1;
  for (let i = 0; i < pairCount; i++) {
    const bond = bondBetween(g, best.order[i], best.order[(i + 1) % length]);
    if (!bond) continue;
    parentBonds.push(bond.id);
    if (aromatic) continue;
    if (bond.order === 2) {
      eneBonds.push(bond.id);
      const found = bondStereo(g, mol, bond, rings.ringAtoms);
      if (found) stereo.push({ bondId: bond.id, locant: i + 1, ...found });
    }
    if (bond.order === 3) yneBonds.push(bond.id);
  }

  // High-school style: cis/trans sits right before the locant it belongs to
  // (but-cis-2-ene, cis-2-butene, hexa-trans-2,cis-4-diene).
  const parentWithStereo = embedStereo(parent, stereo, best.eneLocants);
  let name = joinName(prefixes, parentWithStereo);
  if (esterWord) name = `${esterWord} ${name}`;

  const numbers: Record<string, number> = {};
  best.order.forEach((id, i) => {
    numbers[id] = i + 1;
  });

  const carbonCount = mol.atoms.filter((a) => a.element === "C").length;
  const hydrogens = g.ids.reduce((sum, id) => sum + (MAX_VALENCE[element(g, id)] - valence(g, id)), 0);
  const others = mol.atoms.filter((a) => a.element !== "C");
  const counts = new Map<string, number>();
  for (const atom of others) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  const formula =
    `C${carbonCount > 1 ? carbonCount : ""}${hydrogens ? `H${hydrogens > 1 ? hydrogens : ""}` : ""}` +
    [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([el, n]) => `${el}${n > 1 ? n : ""}`)
      .join("");

  return {
    ok: true,
    name,
    formula,
    analysis: {
      kind: aromatic ? "benzene" : cyclic ? "ring" : "chain",
      atoms: best.order,
      bonds: parentBonds,
      length,
      eneLocants: best.eneLocants,
      yneLocants: best.yneLocants,
      eneBonds,
      yneBonds,
      pcg: hasSuffix ? pcg : null,
      pcgLabel: hasSuffix && pcg ? GROUP_LABEL[pcg] : null,
      pcgLocants: suffixLocants,
      pcgAtoms: activeGroups.flatMap((group) => [group.anchor, ...group.atoms]),
      pcgBonds: activeGroups.flatMap((group) => group.bonds),
      suffixLabel: suffixText,
      substituents: [...best.subs, ...nSubs],
      groups: prefixGroups,
      esterWord,
      stereo,
      parent,
      name,
      numbers,
      ringCount: rings.rings.length,
      chainAlternative,
      parentCriterion,
      numberingCriterion,
      reversed: {
        eneLocants: reverse.eneLocants,
        yneLocants: reverse.yneLocants,
        subLocants: reverse.subLocants,
        pcgLocants: reverse.pcgLocants,
      },
    },
  };
}
