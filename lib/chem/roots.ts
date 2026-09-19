export type NameStyle = "modern" | "classic";

const STEMS = [
  "", "meth", "eth", "prop", "but", "pent", "hex", "hept", "oct", "non", "dec",
  "undec", "dodec", "tridec", "tetradec", "pentadec", "hexadec", "heptadec",
  "octadec", "nonadec", "icos",
];

const MULTIPLIERS = ["", "", "di", "tri", "tetra", "penta", "hexa", "hepta", "octa", "nona", "deca"];
const COMPLEX_MULTIPLIERS = ["", "", "bis", "tris", "tetrakis", "pentakis", "hexakis"];

export function stem(n: number): string {
  return STEMS[n] ?? `C${n}`;
}

export function multiplier(n: number): string {
  return MULTIPLIERS[n] ?? `${n}-fold`;
}

export function complexMultiplier(n: number): string {
  return COMPLEX_MULTIPLIERS[n] ?? `${n}-fold`;
}

export const maxChainLength = STEMS.length - 1;

export type SuffixToken = {
  locants: number[];
  /** "ane", "ene", "diene", "ol", "one", "oic acid", … */
  label: string;
  showLocants: boolean;
};

// "yne" behaves like a vowel start: but-2-yne, not "buta-2-yne"
const startsWithVowel = (text: string) => /^[aeiouy]/.test(text);

/**
 * Glues the stem and its suffix tokens together: hexane, hex-2-ene, hexan-2-ol,
 * hexane-1,2-diol, hex-5-en-2-one, hexanoic acid — and the classic spellings of each.
 */
export function assembleParent(opts: {
  stem: string;
  tokens: SuffixToken[];
  style: NameStyle;
}): string {
  const { tokens, style } = opts;
  if (!tokens.length) return opts.stem;

  // "hexa-1,3-diene" needs the linking "a"; "hexane-1,2-diol" and "benzene-1,2-diol" do not.
  const needsLink = !startsWithVowel(tokens[0].label) && !/[aeiou]$/.test(opts.stem);
  const head = opts.stem + (needsLink ? "a" : "");
  const labels = tokens.map((token, i) => {
    const next = tokens[i + 1];
    return next && startsWithVowel(next.label) ? token.label.replace(/e$/, "") : token.label;
  });

  if (style === "modern") {
    let out = head;
    tokens.forEach((token, i) => {
      out += token.showLocants && token.locants.length ? `-${token.locants.join(",")}-` : "";
      out += labels[i];
    });
    return out;
  }

  // classic: the first set of locants moves to the front of the word
  const firstWithLocants = tokens.findIndex((token) => token.showLocants && token.locants.length);
  let out = firstWithLocants >= 0 ? `${tokens[firstWithLocants].locants.join(",")}-${head}` : head;
  tokens.forEach((token, i) => {
    if (i !== firstWithLocants && token.showLocants && token.locants.length) {
      out += `-${token.locants.join(",")}-`;
    }
    out += labels[i];
  });
  return out;
}

/** Alphabetisation key: drop locants, punctuation and the italicised sec-/tert- prefixes. */
export function alphaKey(name: string): string {
  return name
    .replace(/^\(|\)$/g, "")
    .replace(/\b(sec|tert|n)-/g, "")
    .replace(/[0-9,()\[\]\-']/g, "")
    .toLowerCase();
}

/** Joins prefix groups and the parent into the final name. */
export function joinName(prefixes: string[], parent: string): string {
  if (prefixes.length === 0) return parent;
  const glue = /^[0-9]/.test(parent) ? "-" : "";
  return `${prefixes.join("-")}${glue}${parent}`;
}
