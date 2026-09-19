import { growthPoint, type Point } from "./edit";
import type { GroupKind } from "./groups";
import { nameMolecule, type Analysis } from "./name";
import type { Molecule } from "./types";

export type GuideKind = "ok" | "add" | "wrong";

export type GuideMarker = {
  id: string;
  kind: GuideKind;
  text: string;
  /** Atoms/bonds of the drawn structure to light up. */
  atoms?: string[];
  bonds?: string[];
  /** Where a missing piece should go. */
  point?: Point;
};

export type Guidance = {
  /** Faint skeleton shown while the canvas is still empty. */
  ghost?: Molecule;
  markers: GuideMarker[];
  errors: GuideMarker[];
};

const GROUP_SYMBOL: Record<GroupKind, string> = {
  acid: "–COOH",
  ester: "–COO–",
  amide: "–CONH₂",
  nitrile: "–C≡N",
  aldehyde: "–CHO",
  ketone: "=O",
  alcohol: "–OH",
  amine: "–NH₂",
  ether: "–O–",
  halide: "halogen",
};

type Slot = { subs: string[]; group: string | null; bondToNext: number };

function slots(a: Analysis): Slot[] {
  const out: Slot[] = a.atoms.map(() => ({ subs: [], group: null, bondToNext: 1 }));
  for (const sub of a.substituents) {
    if (typeof sub.locant !== "number") continue;
    out[sub.locant - 1]?.subs.push(sub.name);
  }
  if (a.pcg) for (const locant of a.pcgLocants) {
    if (out[locant - 1]) out[locant - 1].group = a.pcg;
  }
  for (const locant of a.eneLocants) if (out[locant - 1]) out[locant - 1].bondToNext = 2;
  for (const locant of a.yneLocants) if (out[locant - 1]) out[locant - 1].bondToNext = 3;
  for (const slot of out) slot.subs.sort();
  return out;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function slotScore(a: Slot, b: Slot): number {
  return (
    (sameList(a.subs, b.subs) ? 2 : 0) +
    (a.group === b.group ? 2 : 0) +
    (a.bondToNext === b.bondToNext ? 1 : 0)
  );
}

/** Matches the drawn chain onto the target chain, trying both directions and every offset. */
function align(user: Slot[], target: Slot[]) {
  const m = user.length;
  const n = target.length;
  let best = { score: -1, map: new Map<number, number>(), reversed: false, offset: 0 };
  const span = Math.min(m, n);
  for (const reversed of [false, true]) {
    for (let offset = 0; offset + span <= Math.max(m, n); offset++) {
      const map = new Map<number, number>();
      let score = 0;
      for (let i = 0; i < span; i++) {
        const userIndex = m <= n ? i : offset + i;
        const targetIndexForward = m <= n ? offset + i : i;
        const targetIndex = reversed ? n - 1 - targetIndexForward : targetIndexForward;
        if (targetIndex < 0 || targetIndex >= n) continue;
        map.set(targetIndex, userIndex);
        score += slotScore(user[userIndex], target[targetIndex]);
      }
      if (score > best.score) best = { score, map, reversed, offset };
    }
  }
  return best;
}

function parentSkeleton(target: Molecule, a: Analysis): Molecule {
  const keep = new Set(a.atoms);
  const byId = new Map(target.atoms.map((atom) => [atom.id, atom]));
  return {
    // Preserve parent-chain order so locant indices line up with ghost.atoms[i].
    atoms: a.atoms.map((id) => byId.get(id)!).filter(Boolean),
    bonds: target.bonds
      .filter((bond) => keep.has(bond.a) && keep.has(bond.b))
      .map((bond) => ({ ...bond, order: 1 as const })),
  };
}

function describeParent(a: Analysis): string {
  if (a.kind === "benzene") return "start with a benzene ring";
  if (a.kind === "ring") return `start with a ${a.length}-carbon ring`;
  return `start with a chain of ${a.length} carbons`;
}

/**
 * Compares what has been drawn with the target and turns the difference into
 * markers: what is already right, what to add next and what is plain wrong.
 */
export function guideTowards(
  user: Molecule,
  target: Molecule,
  _size?: { width: number; height: number },
): Guidance {
  const targetResult = nameMolecule(target);
  if (!targetResult.ok) return { markers: [], errors: [] };
  const t = targetResult.analysis;

  if (!user.atoms.length) {
    // Same coordinates as the target so canvas pan frames both together.
    const ghost = parentSkeleton(target, t);
    const markers: GuideMarker[] = [
      { id: "skeleton", kind: "add", text: describeParent(t), atoms: ghost.atoms.map((a) => a.id) },
    ];
    const ghostSlots = slots(t);
    ghostSlots.forEach((slot, index) => {
      const atom = ghost.atoms[index];
      if (!atom) return;
      if (slot.group) {
        markers.push({
          id: `ghost-group-${index}`,
          kind: "add",
          text: `${GROUP_SYMBOL[slot.group as GroupKind]} on C${index + 1}`,
          point: growthPoint(ghost, atom.id),
        });
      }
      if (slot.bondToNext > 1 && ghost.atoms[index + 1]) {
        markers.push({
          id: `ghost-bond-${index}`,
          kind: "add",
          text: `${slot.bondToNext === 2 ? "double" : "triple"} bond C${index + 1}–C${index + 2}`,
          bonds: ghost.bonds
            .filter(
              (b) =>
                (b.a === atom.id && b.b === ghost.atoms[index + 1].id) ||
                (b.b === atom.id && b.a === ghost.atoms[index + 1].id),
            )
            .map((b) => b.id),
        });
      }
      for (const sub of slot.subs) {
        markers.push({
          id: `ghost-sub-${index}-${sub}`,
          kind: "add",
          text: `${sub} on C${index + 1}`,
          point: growthPoint(ghost, atom.id),
        });
      }
    });
    return { ghost, markers, errors: [] };
  }

  const userResult = nameMolecule(user);
  if (!userResult.ok) {
    return {
      markers: [],
      errors: [{ id: "invalid", kind: "wrong", text: userResult.error, atoms: userResult.atoms ?? [] }],
    };
  }
  const u = userResult.analysis;
  if (userResult.name === targetResult.name) {
    return { markers: [{ id: "done", kind: "ok", text: "that's it", atoms: u.atoms }], errors: [] };
  }

  const userSlots = slots(u);
  const targetSlots = slots(t);
  const best = align(userSlots, targetSlots);
  const markers: GuideMarker[] = [];
  const errors: GuideMarker[] = [];

  // 1. the parent skeleton itself
  if (u.length < t.length) {
    const ends = [u.atoms[0], u.atoms[u.atoms.length - 1]];
    const missing = t.length - u.length;
    markers.push({
      id: "length",
      kind: "add",
      text: `${missing} more carbon${missing > 1 ? "s" : ""} in the main chain`,
      atoms: u.atoms,
      point: growthPoint(user, best.reversed ? ends[0] : ends[ends.length - 1]),
    });
  } else if (u.length > t.length) {
    errors.push({
      id: "too-long",
      kind: "wrong",
      text: `the main chain is ${u.length} carbons, it should be ${t.length}`,
      atoms: u.atoms,
    });
  } else if (u.kind !== t.kind) {
    errors.push({
      id: "wrong-parent",
      kind: "wrong",
      text: `the parent should be ${describeParent(t).replace("start with ", "")}`,
      atoms: u.atoms,
    });
  } else {
    markers.push({ id: "length", kind: "ok", text: `${t.length}-carbon parent — right`, atoms: u.atoms });
  }

  const userAtomFor = (targetIndex: number) => {
    const index = best.map.get(targetIndex);
    return index === undefined ? undefined : u.atoms[index];
  };

  // 2. the principal group
  targetSlots.forEach((slot, index) => {
    if (!slot.group) return;
    const atomId = userAtomFor(index);
    const drawn = atomId ? userSlots[best.map.get(index)!].group : null;
    if (drawn === slot.group) {
      markers.push({
        id: `group-${index}`,
        kind: "ok",
        text: `${GROUP_SYMBOL[slot.group as GroupKind]} in the right place`,
        atoms: atomId ? [atomId] : undefined,
      });
      return;
    }
    markers.push({
      id: `group-${index}`,
      kind: "add",
      text: `${GROUP_SYMBOL[slot.group as GroupKind]} goes here`,
      atoms: atomId ? [atomId] : undefined,
      point: atomId ? growthPoint(user, atomId) : undefined,
    });
  });

  // 3. double and triple bonds
  targetSlots.forEach((slot, index) => {
    if (slot.bondToNext === 1) return;
    const fromId = userAtomFor(index);
    const toId = userAtomFor(index + 1);
    const word = slot.bondToNext === 2 ? "double" : "triple";
    if (!fromId || !toId) {
      markers.push({ id: `bond-${index}`, kind: "add", text: `a ${word} bond in the chain` });
      return;
    }
    const bond = user.bonds.find(
      (b) => (b.a === fromId && b.b === toId) || (b.b === fromId && b.a === toId),
    );
    if (bond?.order === slot.bondToNext) {
      markers.push({ id: `bond-${index}`, kind: "ok", text: `${word} bond — right`, bonds: [bond.id] });
    } else {
      markers.push({
        id: `bond-${index}`,
        kind: "add",
        text: `make this bond ${word}`,
        bonds: bond ? [bond.id] : undefined,
        atoms: [fromId, toId],
      });
    }
  });

  // 4. substituents, position by position
  targetSlots.forEach((slot, index) => {
    const userIndex = best.map.get(index);
    const drawn = userIndex === undefined ? [] : [...userSlots[userIndex].subs];
    for (const sub of slot.subs) {
      const at = drawn.indexOf(sub);
      if (at >= 0) {
        drawn.splice(at, 1);
        markers.push({
          id: `sub-${index}-${sub}`,
          kind: "ok",
          text: `${sub} where it belongs`,
          atoms: userIndex === undefined ? undefined : [u.atoms[userIndex]],
        });
      } else {
        const atomId = userAtomFor(index);
        markers.push({
          id: `sub-${index}-${sub}`,
          kind: "add",
          text: `${sub} goes here`,
          atoms: atomId ? [atomId] : undefined,
          point: atomId ? growthPoint(user, atomId) : undefined,
        });
      }
    }
    for (const extra of drawn) {
      const substituent = u.substituents.find(
        (s) => s.name === extra && s.locant === (userIndex ?? -1) + 1,
      );
      errors.push({
        id: `extra-${index}-${extra}`,
        kind: "wrong",
        text: `this ${extra} does not belong here`,
        atoms: substituent?.atoms,
        bonds: substituent?.bonds,
      });
    }
  });

  // anything drawn past the end of the target chain
  for (const [, userIndex] of best.map) void userIndex;
  const mapped = new Set([...best.map.values()]);
  userSlots.forEach((slot, index) => {
    if (mapped.has(index)) return;
    if (!slot.subs.length && !slot.group) return;
    errors.push({
      id: `outside-${index}`,
      kind: "wrong",
      text: "this part is not in the target",
      atoms: [u.atoms[index]],
    });
  });

  const ordered = [
    ...markers.filter((marker) => marker.kind === "add"),
    ...markers.filter((marker) => marker.kind === "ok"),
  ];
  return { markers: ordered, errors };
}
