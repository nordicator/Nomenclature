import { isHalogen } from "./elements";
import { element, neighbors, type Graph } from "./graph";

export type GroupKind =
  | "acid"
  | "ester"
  | "amide"
  | "nitrile"
  | "aldehyde"
  | "ketone"
  | "alcohol"
  | "amine"
  | "ether"
  | "halide";

/** Seniority: the highest-ranked group present becomes the suffix, the rest are prefixes. */
export const GROUP_RANK: Record<GroupKind, number> = {
  acid: 90,
  ester: 80,
  amide: 70,
  nitrile: 60,
  aldehyde: 50,
  ketone: 40,
  alcohol: 30,
  amine: 20,
  ether: 0,
  halide: 0,
};

export const GROUP_LABEL: Record<GroupKind, string> = {
  acid: "carboxylic acid",
  ester: "ester",
  amide: "amide",
  nitrile: "nitrile",
  aldehyde: "aldehyde",
  ketone: "ketone",
  alcohol: "alcohol",
  amine: "amine",
  ether: "ether",
  halide: "halogen",
};

export type Group = {
  kind: GroupKind;
  /** The carbon the suffix/prefix hangs off — it has to sit in the parent chain. */
  anchor: string;
  /** Atoms belonging to the group itself (never the anchor carbon). */
  atoms: string[];
  bonds: string[];
  nitrogen?: string;
  /** Ester only: the -O- and the carbon chain on its far side. */
  esterOxygen?: string;
  esterCarbon?: string;
};

const heavyNeighbors = (g: Graph, id: string) => neighbors(g, id);

/** Finds every functional group in the structure, most senior first. */
export function findGroups(g: Graph): Group[] {
  const groups: Group[] = [];
  const claimed = new Set<string>();

  for (const id of g.ids) {
    if (element(g, id) !== "C") continue;
    const ns = neighbors(g, id);

    const tripleN = ns.find((n) => element(g, n.atom) === "N" && n.bond.order === 3);
    if (tripleN) {
      groups.push({
        kind: "nitrile",
        anchor: id,
        atoms: [tripleN.atom],
        bonds: [tripleN.bond.id],
        nitrogen: tripleN.atom,
      });
      claimed.add(tripleN.atom);
      continue;
    }

    const carbonyl = ns.find((n) => element(g, n.atom) === "O" && n.bond.order === 2);
    if (!carbonyl) continue;

    const singleOxygens = ns.filter((n) => element(g, n.atom) === "O" && n.bond.order === 1);
    const hydroxyl = singleOxygens.find((n) => heavyNeighbors(g, n.atom).length === 1);
    const bridging = singleOxygens.find((n) => heavyNeighbors(g, n.atom).length === 2);
    const amideN = ns.find((n) => element(g, n.atom) === "N" && n.bond.order === 1);

    if (hydroxyl) {
      groups.push({
        kind: "acid",
        anchor: id,
        atoms: [carbonyl.atom, hydroxyl.atom],
        bonds: [carbonyl.bond.id, hydroxyl.bond.id],
      });
      claimed.add(carbonyl.atom);
      claimed.add(hydroxyl.atom);
    } else if (bridging) {
      const far = neighbors(g, bridging.atom).find((n) => n.atom !== id);
      groups.push({
        kind: "ester",
        anchor: id,
        atoms: [carbonyl.atom, bridging.atom],
        bonds: [carbonyl.bond.id, bridging.bond.id],
        esterOxygen: bridging.atom,
        esterCarbon: far?.atom,
      });
      claimed.add(carbonyl.atom);
      claimed.add(bridging.atom);
    } else if (amideN) {
      groups.push({
        kind: "amide",
        anchor: id,
        atoms: [carbonyl.atom, amideN.atom],
        bonds: [carbonyl.bond.id, amideN.bond.id],
        nitrogen: amideN.atom,
      });
      claimed.add(carbonyl.atom);
      claimed.add(amideN.atom);
    } else {
      const carbons = ns.filter((n) => element(g, n.atom) === "C").length;
      groups.push({
        kind: carbons >= 2 ? "ketone" : "aldehyde",
        anchor: id,
        atoms: [carbonyl.atom],
        bonds: [carbonyl.bond.id],
      });
      claimed.add(carbonyl.atom);
    }
  }

  for (const id of g.ids) {
    if (claimed.has(id)) continue;
    const el = element(g, id);
    const ns = neighbors(g, id);

    if (el === "O") {
      const carbons = ns.filter((n) => element(g, n.atom) === "C");
      if (ns.length === 1 && carbons.length === 1) {
        groups.push({ kind: "alcohol", anchor: carbons[0].atom, atoms: [id], bonds: [carbons[0].bond.id] });
      } else if (ns.length === 2 && carbons.length === 2) {
        groups.push({
          kind: "ether",
          anchor: carbons[0].atom,
          atoms: [id],
          bonds: ns.map((n) => n.bond.id),
          esterOxygen: id,
          esterCarbon: carbons[1].atom,
        });
      }
      continue;
    }

    if (el === "N" && ns.every((n) => n.bond.order === 1)) {
      const carbons = ns.filter((n) => element(g, n.atom) === "C");
      if (carbons.length) {
        groups.push({
          kind: "amine",
          anchor: carbons[0].atom,
          atoms: [id],
          bonds: [carbons[0].bond.id],
          nitrogen: id,
        });
      }
      continue;
    }

    if (isHalogen(el) && ns.length === 1) {
      groups.push({ kind: "halide", anchor: ns[0].atom, atoms: [id], bonds: [ns[0].bond.id] });
    }
  }

  return groups.sort((a, b) => GROUP_RANK[b.kind] - GROUP_RANK[a.kind]);
}

/** The group that decides the suffix, or null for a plain hydrocarbon. */
export function principalKind(groups: Group[]): GroupKind | null {
  const best = groups.filter((group) => GROUP_RANK[group.kind] > 0)[0];
  return best?.kind ?? null;
}
