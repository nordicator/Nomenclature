import { GROUP_LABEL } from "./groups";
import type { Analysis } from "./name";
import { stem } from "./roots";

export type Highlight = {
  atoms?: string[];
  bonds?: string[];
  numbers?: Record<string, number>;
  accent?: "chain" | "branch" | "bond" | "group";
};

export type Step = {
  id: string;
  title: string;
  detail: string;
  chip?: string;
  highlight: Highlight;
};

const list = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const countWord = (n: number) =>
  ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? `${n}`;

const SUFFIX_NOTE: Record<string, string> = {
  acid: "A -COOH beats every other group, and its carbon is always C1.",
  ester: "An ester is named as two words: the group on the oxygen first, then the acid part as -oate.",
  amide: "A -CONH₂ carbon is always C1, and anything on the nitrogen is labelled N- instead of a number.",
  nitrile: "The -C≡N carbon counts as part of the chain and is always C1.",
  aldehyde: "A -CHO can only sit at the end of a chain, so it is always C1.",
  ketone: "A C=O with carbons on both sides is a ketone, so the name ends in -one.",
  alcohol: "An -OH outranks alkenes, halogens and alkyl groups, so it gets the suffix and the lowest number.",
  amine: "An -NH₂ takes the -amine suffix; groups on the nitrogen itself are labelled N-.",
};

function groupStep(a: Analysis): Step | null {
  if (!a.pcg) return null;
  const label = GROUP_LABEL[a.pcg];
  return {
    id: "group",
    title: "Find the main functional group",
    detail: `${SUFFIX_NOTE[a.pcg] ?? ""} This is ${
      /^[aeiou]/.test(label) ? "an" : "a"
    } ${label}, so the ending is "${a.suffixLabel}".`.trim(),
    chip: a.suffixLabel ?? undefined,
    highlight: { atoms: a.pcgAtoms, bonds: a.pcgBonds, accent: "group" },
  };
}

function parentStep(a: Analysis): Step {
  const parentAtoms = { atoms: a.atoms, bonds: a.bonds, accent: "chain" as const };
  if (a.kind === "benzene") {
    return {
      id: "parent",
      title: "Spot the benzene ring",
      detail:
        "Six carbons in a ring with alternating double bonds is a benzene ring — it becomes the parent and everything else hangs off it.",
      chip: a.parent,
      highlight: parentAtoms,
    };
  }
  if (a.kind === "ring") {
    const alt = a.chainAlternative;
    const detail = alt
      ? `The ring has ${a.length} carbons and the longest chain hanging off it only ${alt.length}, so the ring is the parent (cyclo${stem(a.length)}…) and the chain becomes a substituent.`
      : `Every carbon sits in one ${a.length}-membered ring, so the parent is cyclo${stem(a.length)}…`;
    return {
      id: "parent",
      title: "The ring is the parent",
      detail,
      chip: `cyclo${stem(a.length)}`,
      highlight: parentAtoms,
    };
  }

  const unsaturations = a.eneLocants.length + a.yneLocants.length;
  let detail = `The longest continuous carbon chain is ${a.length} carbons long, so the stem is "${stem(a.length)}".`;
  const alt = a.chainAlternative;
  if (a.pcg && a.parentCriterion === "group" && alt) {
    detail = `The chain has to run through the carbon carrying the ${GROUP_LABEL[a.pcg]} group, which gives ${a.length} carbons — stem "${stem(a.length)}".`;
  } else if (unsaturations && a.parentCriterion === "unsaturation" && alt) {
    detail = `The parent chain has to contain the ${a.eneLocants.length ? "C=C" : "C≡C"}, so we take the ${a.length}-carbon chain through it rather than the ${alt.length}-carbon chain that misses it. Stem: "${stem(a.length)}".`;
  } else if (a.parentCriterion === "count" && alt) {
    detail = `Two different ${a.length}-carbon chains exist. The tie-breaker is the number of branches, and this one carries ${countWord(a.substituents.length)} against ${countWord(alt.substituents)}. Stem: "${stem(a.length)}".`;
  } else if (alt && alt.length < a.length) {
    detail += ` The next longest chain is only ${alt.length} carbon${alt.length === 1 ? "" : "s"}, so it loses.`;
  }
  if (a.pcg) detail += ` It has to include the carbon holding the ${GROUP_LABEL[a.pcg]} group.`;
  if (a.ringCount > 0) detail += " The ring is smaller than the chain, so it is named as a substituent instead.";
  return { id: "parent", title: "Find the parent chain", detail, chip: stem(a.length), highlight: parentAtoms };
}

function numberingStep(a: Analysis): Step {
  const highlight: Highlight = { atoms: a.atoms, bonds: a.bonds, numbers: a.numbers, accent: "chain" };
  const subLocants = a.substituents
    .filter((s) => typeof s.locant === "number")
    .map((s) => s.locant as number)
    .sort((x, y) => x - y);
  let detail: string;

  switch (a.numberingCriterion) {
    case "groupLocants":
      detail = `The ${a.pcg ? GROUP_LABEL[a.pcg] : "main"} group gets the lowest number it can: C${a.pcgLocants.join(", C")} this way against C${a.reversed.pcgLocants.join(", C")} from the other end. Everything else is numbered to suit it.`;
      break;
    case "eneLocants":
      detail = `Both ends give the same set of locants (${[...a.eneLocants, ...a.yneLocants]
        .sort((x, y) => x - y)
        .join(", ")}), so the tie goes to the double bond: it takes the lower number (C${a.eneLocants.join(", C")}) and the triple bond gets C${a.yneLocants.join(", C")}.`;
      break;
    case "unsatLocants": {
      const mine = [...a.eneLocants, ...a.yneLocants].sort((x, y) => x - y);
      const theirs = [...a.reversed.eneLocants, ...a.reversed.yneLocants].sort((x, y) => x - y);
      detail = `Number so the multiple bond gets the lowest locant. This way it sits at C${mine.join(", C")}; from the other end it would be C${theirs.join(", C")}.`;
      break;
    }
    case "subLocants":
      detail = `Number from the end that reaches a branch first. This direction gives ${subLocants.join(", ")}; the other gives ${a.reversed.subLocants.join(", ")} — compare them one at a time and the first smaller number wins.`;
      break;
    case "alphabet":
      detail = `Both directions give the same set of locants (${subLocants.join(", ")}), so the tie goes to the prefix that comes first alphabetically: ${a.groups[0]?.name} gets the lower number.`;
      break;
    default:
      if (a.pcg) {
        detail = `The ${GROUP_LABEL[a.pcg]} group fixes where C1 is${a.pcgLocants.length ? ` (C${a.pcgLocants.join(", C")})` : ""}.`;
      } else if (a.eneLocants.length || a.yneLocants.length) {
        detail = `Both directions put the multiple bond in the same place (C${[...a.eneLocants, ...a.yneLocants]
          .sort((x, y) => x - y)
          .join(", C")}), so either one is fine.`;
      } else if (a.substituents.length) {
        detail = "Both directions give the same numbers here, so either one is fine.";
      } else {
        detail = "Nothing is attached, so no locants are needed at all.";
      }
  }
  if (a.kind === "ring" || a.kind === "benzene") {
    detail = `${detail} On a ring you can start anywhere and go either way round — pick the start that gives the lowest numbers.`;
  }
  return { id: "numbering", title: "Number the carbons", detail, highlight };
}

function unsaturationStep(a: Analysis): Step | null {
  if (!a.eneLocants.length && !a.yneLocants.length) {
    if (a.kind === "benzene") return null;
    return {
      id: "saturation",
      title: "Single bonds only",
      detail: `Every bond in the parent is a single bond, so the skeleton is "${stem(a.length)}an…".`,
      chip: "-ane",
      highlight: { atoms: a.atoms, bonds: a.bonds, accent: "chain" },
    };
  }
  const bits: string[] = [];
  if (a.eneLocants.length) {
    bits.push(
      `${a.eneLocants.length > 1 ? `${a.eneLocants.length} double bonds` : "a double bond"} starting at C${a.eneLocants.join(", C")} → -ene`,
    );
  }
  if (a.yneLocants.length) {
    bits.push(
      `${a.yneLocants.length > 1 ? `${a.yneLocants.length} triple bonds` : "a triple bond"} starting at C${a.yneLocants.join(", C")} → -yne`,
    );
  }
  return {
    id: "unsaturation",
    title: "Name the multiple bonds",
    detail: `The parent has ${list(bits)}. The locant is the lower-numbered carbon of the two the bond joins, which gives "${a.parent}".`,
    chip: a.parent,
    highlight: { bonds: [...a.eneBonds, ...a.yneBonds], atoms: a.atoms, accent: "bond" },
  };
}

function stereoStep(a: Analysis): Step | null {
  if (!a.stereo.length) return null;
  const first = a.stereo[0];
  const many = a.stereo.length > 1;
  const sideWord = (cis: boolean) => (cis ? "the same side" : "opposite sides");
  const detail = many
    ? `Each double bond gets its own label: ${a.stereo
        .map((s) => `C${s.locant} is ${s.descriptor}`)
        .join(", ")}. cis means the two groups that count sit on the same side of the bond, trans means opposite sides.`
    : first.simple
      ? `Each carbon of the C=C carries one chain and one hydrogen. The two chains are drawn on ${sideWord(
          first.descriptor === "cis",
        )} of the double bond, which makes it ${first.descriptor}.`
      : `One of the carbons carries two different groups, so rank them by atomic number first — the heavier atom wins. The two winners are on ${sideWord(
          first.descriptor === "cis",
        )}, so it is ${first.descriptor}.`;
  return {
    id: "stereo",
    title: many ? "Label each double bond" : `Same side or opposite? → ${first.descriptor}`,
    detail,
    chip: many ? a.stereo.map((s) => `${s.descriptor}-${s.locant}`).join(",") : `${first.descriptor}-${first.locant}`,
    highlight: { bonds: a.stereo.map((s) => s.bondId), atoms: a.atoms, accent: "bond" },
  };
}

function substituentSteps(a: Analysis): Step[] {
  return a.groups.map((group, i) => {
    const copies = group.locants.length;
    const carbons = a.substituents.find((s) => s.name === group.name)?.carbons ?? 0;
    const where =
      group.locants[0] === "N"
        ? "on the nitrogen"
        : copies === 1
          ? `on C${group.locants[0]}`
          : `on C${group.locants.join(" and C")}`;
    const multi =
      copies > 1 ? ` Identical groups share one prefix with a multiplier: ${group.text}.` : "";
    const what = carbons ? `A ${carbons}-carbon group` : "A group";
    return {
      id: `sub-${i}`,
      title: `Prefix: ${group.name}`,
      detail: `${what} sits ${where}, named "${group.name}".${multi}`,
      chip: group.text,
      highlight: { atoms: group.atoms, bonds: group.bonds, accent: "branch" },
    };
  });
}

function alphabetStep(a: Analysis): Step | null {
  if (a.groups.length < 2) return null;
  return {
    id: "alphabet",
    title: "Order the prefixes",
    detail: `Prefixes are written alphabetically — ${list(
      a.groups.map((g) => g.name),
    )} — ignoring the di/tri/tetra multipliers and the italic sec-/tert- bits when you compare them.`,
    chip: a.groups.map((g) => g.text).join("-"),
    highlight: {
      atoms: a.groups.flatMap((g) => g.atoms),
      bonds: a.groups.flatMap((g) => g.bonds),
      accent: "branch",
    },
  };
}

function finalStep(a: Analysis): Step {
  const pieces = [...a.groups.map((g) => g.text), a.parent];
  if (a.esterWord) pieces.unshift(`${a.esterWord} (on the ester oxygen)`);
  if (a.stereo.length) {
    pieces.push(
      a.stereo.length === 1 && a.eneLocants.length === 1
        ? a.stereo[0].descriptor
        : a.stereo.map((s) => `${s.descriptor}-${s.locant}`).join(", "),
    );
  }
  return {
    id: "final",
    title: "Put it together",
    detail: `${pieces.join(" + ")} → ${a.name}. Numbers are split from words by hyphens and from each other by commas, and the whole thing is written as one word.`,
    chip: a.name,
    highlight: { atoms: a.atoms, bonds: a.bonds, numbers: a.numbers, accent: "chain" },
  };
}

export function explain(analysis: Analysis): Step[] {
  const steps: Step[] = [];
  const group = groupStep(analysis);
  if (group) steps.push(group);
  steps.push(parentStep(analysis), numberingStep(analysis));
  const unsaturation = unsaturationStep(analysis);
  if (unsaturation) steps.push(unsaturation);
  const stereo = stereoStep(analysis);
  if (stereo) steps.push(stereo);
  steps.push(...substituentSteps(analysis));
  const alphabet = alphabetStep(analysis);
  if (alphabet) steps.push(alphabet);
  steps.push(finalStep(analysis));
  return steps.map((step, i) => ({ ...step, title: `${i + 1}. ${step.title}` }));
}
