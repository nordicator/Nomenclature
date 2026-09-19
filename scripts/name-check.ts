/** Quick sanity sweep over the naming engine: pnpm exec tsx scripts/name-check.ts */
import { nameMolecule } from "../lib/chem/name";
import { parseSmiles } from "../lib/chem/smiles";

const cases: [string, string][] = [
  ["C", "methane"],
  ["CCCC", "butane"],
  ["CC(C)C", "2-methylpropane"],
  ["CCC(C)CC", "3-methylpentane"],
  ["CC(C)C(C)C", "2,3-dimethylbutane"],
  ["CCC(CC)CC", "3-ethylpentane"],
  ["CC(C)CC", "2-methylbutane"],
  ["CC(C)(C)C", "2,2-dimethylpropane"],
  ["CC(C)CC(C)C", "2,4-dimethylpentane"],
  ["CCC(C)C(C)CC", "3,4-dimethylhexane"],
  ["CCCC(C(C)C)CCC", "4-isopropylheptane"],
  ["CCCCC(C(C)(C)C)CCCC", "5-tert-butylnonane"],
  ["CCC(C)C(CC)CCCC", "4-ethyl-3-methyloctane"],
  ["C=C", "ethene"],
  ["C#C", "ethyne"],
  ["CC=CC", "trans-but-2-ene"],
  ["CC=CCC", "trans-pent-2-ene"],
  ["C=CCC=C", "penta-1,4-diene"],
  ["C#CCC=C", "pent-1-en-4-yne"],
  ["CC#CC", "but-2-yne"],
  ["CCC#C", "but-1-yne"],
  ["CC=C(C)C", "2-methylbut-2-ene"],
  ["C=CC(C)C", "3-methylbut-1-ene"],
  ["C=CC(CC)CC", "3-ethylpent-1-ene"],

  // functional groups
  ["CCO", "ethanol"],
  ["CCCO", "propan-1-ol"],
  ["CC(O)C", "propan-2-ol"],
  ["OCCO", "ethane-1,2-diol"],
  ["CC(C)(O)C", "2-methylpropan-2-ol"],
  ["CC(=O)C", "propan-2-one"],
  ["CCCC(=O)C", "pentan-2-one"],
  ["CCC=O", "propanal"],
  ["CC(=O)O", "ethanoic acid"],
  ["CCC(=O)O", "propanoic acid"],
  ["OC(=O)CCC(=O)O", "butanedioic acid"],
  ["CC(=O)OC", "methyl ethanoate"],
  ["CCC(=O)OCC", "ethyl propanoate"],
  ["CC(=O)N", "ethanamide"],
  ["CC(=O)NC", "N-methylethanamide"],
  ["CCN", "ethanamine"],
  ["CCCN", "propan-1-amine"],
  ["CN(C)C", "N,N-dimethylmethanamine"],
  ["CCC#N", "propanenitrile"],
  ["CCOC", "methoxyethane"],
  ["CCCCl", "1-chloropropane"],
  ["ClCC(Cl)C", "1,2-dichloropropane"],
  ["OCC=C", "prop-2-en-1-ol"],
  ["CC(O)CC(=O)O", "3-hydroxybutanoic acid"],
  ["CC(=O)CC(=O)O", "3-oxobutanoic acid"],
  ["OC1CCCCC1", "cyclohexanol"],
  ["O=C1CCCCC1", "cyclohexanone"],
  ["OC1=CC=CC=C1", "phenol"],
  ["NC1=CC=CC=C1", "aniline"],
  ["OC(=O)C1=CC=CC=C1", "benzoic acid"],
  ["O=CC1=CC=CC=C1", "benzaldehyde"],
  ["COC(=O)C1=CC=CC=C1", "methyl benzoate"],
  ["OC(=O)C1CCCCC1", "cyclohexanecarboxylic acid"],
  ["CC(=O)C1=CC=CC=C1", "1-phenylethanone"],
  ["C1CCCCC1", "cyclohexane"],
  ["CC1CCCCC1", "methylcyclohexane"],
  ["CC1CCCCC1C", "1,2-dimethylcyclohexane"],
  ["C1=CCCCC1", "cyclohexene"],
  ["CC1=CCCCC1", "1-methylcyclohex-1-ene"],
  ["C1=CC=CC=C1", "benzene"],
  ["CC1=CC=CC=C1", "methylbenzene"],
  ["CCCCCCCCC1=CC=CC=C1", "1-phenyloctane"],
  ["C1CC1", "cyclopropane"],
  ["CCCC1CCCC1", "propylcyclopentane"],
];

let failures = 0;
for (const [smiles, expected] of cases) {
  const result = nameMolecule(parseSmiles(smiles));
  const got = result.ok ? result.name : `ERROR: ${result.error}`;
  const pass = got === expected;
  if (!pass) failures++;
  console.log(`${pass ? "ok  " : "FAIL"}  ${smiles.padEnd(22)} ${got}${pass ? "" : `   (expected ${expected})`}`);
}
console.log(failures ? `\n${failures} failing` : "\nall good");
