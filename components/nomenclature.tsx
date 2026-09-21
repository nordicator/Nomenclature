"use client";

import { MoleculeCanvas, HIGHLIGHT_COLOR, panToCentre, type Tool, type ViewPan } from "@/components/molecule-canvas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GROUP_STAMPS, type GroupStamp } from "@/lib/chem/edit";
import type { Element } from "@/lib/chem/elements";
import { explain, overviewLayers } from "@/lib/chem/explain";
import { guideTowards, type Guidance } from "@/lib/chem/guidance";
import {
  buildRun,
  DEFAULT_GROUPS,
  EXAMPLES,
  moleculeFromSmiles,
  type ChallengeMode,
  type Difficulty,
  type GroupOption,
  type Question,
  type RunPace,
  type RunSetup,
} from "@/lib/chem/library";
import { nameMolecule } from "@/lib/chem/name";
import { makeSeed } from "@/lib/chem/rng";
import type { NameStyle } from "@/lib/chem/roots";
import { layout } from "@/lib/chem/smiles";
import { emptyMolecule, type Molecule } from "@/lib/chem/types";
import { checkName, nameVariants } from "@/lib/chem/variants";
import { formatTime, type ShareResult } from "@/lib/share-card";
import {
  ChevronDown,
  Crosshair,
  Eraser,
  Lightbulb,
  ListOrdered,
  Redo2,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BreakdownPanel } from "@/components/breakdown-panel";
import { ChallengeResults } from "@/components/challenge-results";
import { ChallengeSetup } from "@/components/challenge-setup";

const BOND_TOOLS = [
  { id: "single", glyph: "—", label: "Single bond", key: "1" },
  { id: "double", glyph: "=", label: "Double bond", key: "2" },
  { id: "triple", glyph: "≡", label: "Triple bond", key: "3" },
];

const ATOM_TOOLS: Element[] = ["O", "N", "Cl", "Br", "F", "I"];
const STAMP_TOOLS = Object.keys(GROUP_STAMPS) as GroupStamp[];

type Attempt = { correct: boolean; revealed: boolean; hints: number; ms: number };

function toolFromId(id: string): Tool {
  if (id === "erase") return { kind: "erase" };
  if (id.startsWith("atom:")) return { kind: "atom", element: id.slice(5) as Element };
  if (id.startsWith("group:")) return { kind: "group", stamp: id.slice(6) as GroupStamp };
  return { kind: "bond", order: id === "double" ? 2 : id === "triple" ? 3 : 1 };
}

export function Nomenclature() {
  const params = useSearchParams();
  const sharedSeed = params.get("seed");

  const [molecule, setMoleculeState] = useState<Molecule>(emptyMolecule);
  const [past, setPast] = useState<Molecule[]>([]);
  const [future, setFuture] = useState<Molecule[]>([]);
  const [toolId, setToolId] = useState("single");
  const [style, setStyle] = useState<NameStyle>("modern");
  const [showLabels, setShowLabels] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"draw" | "challenge">(sharedSeed ? "challenge" : "draw");

  const [setup, setSetup] = useState<RunSetup>(() => ({
    seed: (sharedSeed ?? makeSeed()).toUpperCase(),
    mode: (params.get("m") as ChallengeMode) || "draw",
    difficulty: (params.get("d") as Difficulty) || "easy",
    count: Number(params.get("n")) || 5,
    groups: (params.get("g")?.split(",").filter(Boolean) as GroupOption[]) ?? DEFAULT_GROUPS,
    pace: (params.get("p") as RunPace) || "strict",
  }));
  const [phase, setPhase] = useState<"setup" | "playing" | "results">("setup");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [answered, setAnswered] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);
  const [runStart, setRunStart] = useState(0);
  const [questionStart, setQuestionStart] = useState(0);
  const [now, setNow] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [pan, setPan] = useState<ViewPan>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  /** Molecule waiting to be framed once the canvas has a real size. */
  const pendingFocus = useRef<Molecule | null>(null);
  /** True after the user pans/zooms; cleared when we programmatically frame. */
  const userPanned = useRef(false);
  const moleculeRef = useRef(molecule);
  const questionFocusRef = useRef<Molecule | null>(null);
  moleculeRef.current = molecule;

  const canvasSize = useCallback(() => {
    const el = canvasRef.current;
    if (el) {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) return { width, height };
    }
    return size;
  }, [size]);

  /** Pan so `focus` is centred in the viewport. Never moves atom coordinates. */
  const frameView = useCallback(
    (focus: Molecule | null | undefined) => {
      userPanned.current = false;
      setZoom(1);
      if (!focus?.atoms.length) {
        setPan({ x: 0, y: 0 });
        pendingFocus.current = null;
        return;
      }
      const { width, height } = canvasSize();
      if (width < 80 || height < 80) {
        pendingFocus.current = focus;
        return;
      }
      pendingFocus.current = null;
      setPan(panToCentre(focus, width, height));
    },
    [canvasSize],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) setSize({ width, height });
    };
    // Double-rAF: wait until flex layout has settled after mount / phase change.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(measure);
    });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      observer.disconnect();
    };
  }, [mode, phase]);

  // Frame pending content, and keep centred across canvas resizes (breakdown open, etc.)
  // unless the user has freely panned.
  useEffect(() => {
    if (size.width < 80 || size.height < 80) return;
    const pending = pendingFocus.current;
    if (pending?.atoms.length) {
      pendingFocus.current = null;
      userPanned.current = false;
      setZoom(1);
      setPan(panToCentre(pending, size.width, size.height));
      return;
    }
    if (userPanned.current) return;
    const drawn = moleculeRef.current;
    const focus = drawn.atoms.length ? drawn : questionFocusRef.current;
    if (focus?.atoms.length) {
      setZoom(1);
      setPan(panToCentre(focus, size.width, size.height));
    }
  }, [size]);

  useEffect(() => {
    if (mode !== "challenge" || phase !== "playing") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [mode, phase]);

  const tool = useMemo(() => toolFromId(toolId), [toolId]);

  const setMolecule = useCallback(
    (next: Molecule) => {
      setPast((p) => [...p.slice(-60), molecule]);
      setFuture([]);
      setMoleculeState(next);
    },
    [molecule],
  );

  /** Replace the canvas contents and pan so `focus` (default: the molecule) is centred. */
  const resetCanvas = useCallback(
    (next: Molecule, focus?: Molecule) => {
      setPast([]);
      setFuture([]);
      setMoleculeState(next);
      const target = focus ?? next;
      questionFocusRef.current = target.atoms.length ? target : null;
      frameView(target);
    },
    [frameView],
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setFuture((f) => [molecule, ...f]);
      setMoleculeState(p[p.length - 1]);
      return p.slice(0, -1);
    });
  }, [molecule]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      setPast((p) => [...p, molecule]);
      setMoleculeState(f[0]);
      return f.slice(1);
    });
  }, [molecule]);

  const load = useCallback(
    (next: Molecule) => {
      setMolecule(next);
      questionFocusRef.current = next.atoms.length ? next : null;
      frameView(next);
    },
    [frameView, setMolecule],
  );

  const result = useMemo(() => nameMolecule(molecule, { style }), [molecule, style]);
  const steps = useMemo(() => (result.ok ? explain(result.analysis) : []), [result]);
  const activeStep = Math.min(active, Math.max(steps.length - 1, 0));
  const variants = useMemo(() => (result.ok ? nameVariants(molecule) : null), [result, molecule]);

  const current = questions[index] ?? null;
  const targetVariants = useMemo(
    () => (current ? nameVariants(current.challenge.molecule) : null),
    [current],
  );
  const targetName = useMemo(() => {
    if (!current) return null;
    const named = nameMolecule(current.challenge.molecule, { style });
    return named.ok ? named.name : null;
  }, [current, style]);

  /* ---- run control ---- */

  const showQuestion = useCallback(
    (question: Question) => {
      if (question.kind === "name") {
        resetCanvas(question.challenge.molecule);
      } else {
        // Empty drawing canvas, but pan to where the target/ghost will sit.
        resetCanvas(emptyMolecule(), question.challenge.molecule);
      }
    },
    [resetCanvas],
  );

  const startRun = useCallback(
    (next: RunSetup) => {
      const built = buildRun(next);
      if (!built.length) return;
      setSetup(next);
      setQuestions(built);
      setIndex(0);
      setAttempts([]);
      setAnswered(false);
      setHintsShown(0);
      setAnswer("");
      setWrong(false);
      const stamp = Date.now();
      setRunStart(stamp);
      setQuestionStart(stamp);
      setNow(stamp);
      setPhase("playing");
      setBreakdownOpen(false);
      showQuestion(built[0]);
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        seed: next.seed,
        m: next.mode,
        d: next.difficulty,
        n: String(next.count),
        g: next.groups.join(","),
        p: next.pace,
      }).toString();
      window.history.replaceState(null, "", url.toString());
      setShareUrl(url.toString());
    },
    [showQuestion],
  );

  /** Casual mode: keep finished rounds, rebuild the rest with the new settings. */
  const applyCasualSetup = useCallback(
    (next: RunSetup) => {
      setSetup(next);
      const keepThrough = answered ? index + 1 : index;
      const kept = questions.slice(0, keepThrough);
      const need = Math.max(next.count - kept.length, 0);
      const rebuilt =
        need > 0
          ? buildRun({
              ...next,
              count: need,
              seed: `${next.seed}|c${keepThrough}|${next.difficulty}|${next.groups.join()}`,
            })
          : [];
      const merged = [...kept, ...rebuilt];
      if (!merged.length) return;
      setQuestions(merged);
      if (!answered) {
        const currentQ = merged[index];
        if (!currentQ) return;
        setHintsShown(0);
        setAnswer("");
        setWrong(false);
        showQuestion(currentQ);
      }
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({
        seed: next.seed,
        m: next.mode,
        d: next.difficulty,
        n: String(next.count),
        g: next.groups.join(","),
        p: next.pace,
      }).toString();
      window.history.replaceState(null, "", url.toString());
      setShareUrl(url.toString());
    },
    [answered, index, questions, showQuestion],
  );

  const finish = useCallback(
    (correct: boolean, revealed = false) => {
      setAttempts((list) => [
        ...list,
        { correct, revealed, hints: hintsShown, ms: Date.now() - questionStart },
      ]);
      setAnswered(true);
    },
    [hintsShown, questionStart],
  );

  const goNext = useCallback(() => {
    const nextIndex = index + 1;
    if (nextIndex >= questions.length) {
      setPhase("results");
      return;
    }
    setIndex(nextIndex);
    setAnswered(false);
    setHintsShown(0);
    setAnswer("");
    setWrong(false);
    setBreakdownOpen(false);
    setQuestionStart(Date.now());
    showQuestion(questions[nextIndex]);
  }, [index, questions, showQuestion]);

  // Enter advances once the current round is settled.
  useEffect(() => {
    if (mode !== "challenge" || phase !== "playing" || !answered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      event.stopPropagation();
      goNext();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [answered, goNext, mode, phase]);

  // Keep the naming field focused for each new name question.
  useEffect(() => {
    if (mode !== "challenge" || phase !== "playing" || answered || current?.kind !== "name") return;
    const id = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [answered, current, index, mode, phase]);

  const handleDraw = useCallback(
    (next: Molecule) => {
      setMolecule(next);
      setWrong(false);
    },
    [setMolecule],
  );

  const submitAnswer = useCallback(() => {
    if (!current || answered) return;
    if (current.kind === "name") {
      if (checkName(answer, current.challenge.molecule)) finish(true);
      else setWrong(true);
      return;
    }
    if (!targetName) return;
    const named = nameMolecule(molecule, { style });
    if (named.ok && named.name === targetName) finish(true);
    else setWrong(true);
  }, [answer, answered, current, finish, molecule, style, targetName]);

  /* ---- hints ---- */

  const solved = mode === "challenge" && result.ok && targetName !== null && result.name === targetName;

  const drawGuide = useMemo(
    () =>
      mode === "challenge" && phase === "playing" && current?.kind === "draw"
        ? guideTowards(molecule, current.challenge.molecule)
        : null,
    [mode, phase, current, molecule],
  );

  const targetSteps = useMemo(() => {
    if (!current || current.kind !== "name") return [];
    const named = nameMolecule(current.challenge.molecule, { style });
    return named.ok ? explain(named.analysis) : [];
  }, [current, style]);

  const guide: Guidance | null = useMemo(() => {
    if (mode !== "challenge" || phase !== "playing" || hintsShown === 0) return null;
    if (current?.kind === "name") {
      const step = targetSteps[Math.min(hintsShown, targetSteps.length) - 1];
      if (!step) return null;
      return {
        markers: [
          {
            id: step.id,
            kind: "add",
            text: step.title.replace(/^\d+\.\s*/, "").toLowerCase(),
            atoms: step.highlight.atoms,
            bonds: step.highlight.bonds,
          },
        ],
        errors: [],
      };
    }
    if (!drawGuide || solved) return null;
    return { ...drawGuide, markers: drawGuide.markers.slice(0, hintsShown) };
  }, [current, drawGuide, hintsShown, mode, phase, solved, targetSteps]);

  const centreView = useCallback(() => {
    const focus =
      molecule.atoms.length > 0
        ? molecule
        : current?.challenge.molecule ?? guide?.ghost ?? null;
    frameView(focus);
  }, [frameView, molecule, current, guide]);

  const hintLimit = current?.kind === "name" ? targetSteps.length : drawGuide?.markers.length ?? 0;

  /* ---- keyboard ---- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const match = BOND_TOOLS.find((t) => t.key === event.key);
      if (match) setToolId(match.id);
      if (event.key.toLowerCase() === "e") setToolId("erase");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ---- render ---- */

  const playing = mode === "challenge" && phase === "playing";
  const wasCorrect = answered && (attempts[attempts.length - 1]?.correct ?? false);
  const highlight = breakdownOpen ? steps[activeStep]?.highlight ?? null : null;
  const layers =
    result.ok && wasCorrect && !breakdownOpen ? overviewLayers(result.analysis) : null;
  const showBreakdown = mode === "draw" || (playing && answered);
  const elapsed = playing ? Math.max(now - runStart, 0) : 0;

  const shareResult: ShareResult = {
    seed: setup.seed,
    mode:
      setup.mode === "draw"
        ? "draw it"
        : setup.mode === "name"
          ? "name it"
          : "mixed",
    difficulty: setup.difficulty === "bs" ? "BS" : setup.difficulty,
    total: questions.length,
    correct: attempts.filter((a) => a.correct).length,
    ms: attempts.reduce((sum, a) => sum + a.ms, 0),
    marks: attempts.map((a) => (!a.correct || a.revealed ? "missed" : a.hints ? "hinted" : "clean")),
    url: shareUrl || (typeof window !== "undefined" ? window.location.href : ""),
  };

  const headline =
    mode === "draw"
      ? result.ok
        ? result.name
        : result.kind === "empty"
          ? "nothing drawn yet"
          : result.error
      : current?.kind === "name"
        ? answered
          ? targetName ?? ""
          : "name this structure"
        : targetName ?? "…";

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b px-3 py-2.5">
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value as "draw" | "challenge");
            setBreakdownOpen(false);
          }}
        >
          <TabsList>
            <TabsTrigger value="draw">Sandbox</TabsTrigger>
            <TabsTrigger value="challenge">Challenge</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {playing ? (
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {current?.kind === "name" ? (answered ? "it was" : "name it") : "draw this"}
            </span>
          ) : null}
          {mode === "draw" || playing ? (
            <h1
              className={`max-w-[46ch] truncate text-2xl font-semibold tracking-tight ${
                mode === "draw" && !result.ok && result.kind !== "empty" ? "text-destructive" : ""
              }`}
            >
              {headline}
            </h1>
          ) : null}
          {mode === "draw" && result.ok ? (
            <Badge variant="secondary" className="font-mono">
              {result.formula}
            </Badge>
          ) : null}
          {(() => {
            const shown =
              mode === "draw" ? variants : playing && answered ? targetVariants : null;
            return shown?.alternatives.length ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" title="Other names that also work">
                  <ChevronDown />
                  {shown.alternatives.length} more
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-[320px]">
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Also correct
                </p>
                <ul className="space-y-1.5">
                  {shown.alternatives.map((variant) => (
                    <li key={variant.name} className="text-sm">
                      {variant.name}
                      <span className="block text-xs text-muted-foreground">{variant.note}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
            ) : null;
          })()}
          {showBreakdown ? (
            <Button
              size="sm"
              variant={breakdownOpen ? "secondary" : "outline"}
              onClick={() => setBreakdownOpen((open) => !open)}
              disabled={!result.ok}
            >
              <ListOrdered />
              Breakdown
            </Button>
          ) : null}
          {playing && !answered ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setHintsShown((n) => n + 1)}
              disabled={hintsShown >= hintLimit}
            >
              <Lightbulb />
              Hint
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          {playing ? (
            <>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {formatTime(elapsed)}
              </span>
              <Badge variant="secondary">
                {index + 1} / {questions.length}
              </Badge>
            </>
          ) : null}
          <Select value={style} onValueChange={(value) => setStyle(value as NameStyle)}>
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="modern">hex-2-ene</SelectItem>
              <SelectItem value="classic">2-hexene</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === "challenge" && phase === "setup" ? (
            <ChallengeSetup
              setup={setup}
              onChange={setSetup}
              onStart={() => startRun(setup)}
              shared={!!sharedSeed}
            />
          ) : mode === "challenge" && phase === "results" ? (
            <ChallengeResults
              result={shareResult}
              questions={questions}
              onAgain={() => startRun(setup)}
              onNew={() => {
                setSetup({ ...setup, seed: makeSeed() });
                setPhase("setup");
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={toolId}
                  onValueChange={(value) => value && setToolId(value)}
                >
                  {BOND_TOOLS.map((item) => (
                    <ToggleGroupItem key={item.id} value={item.id} aria-label={item.label} title={item.label}>
                      <span className="font-mono text-base leading-none">{item.glyph}</span>
                    </ToggleGroupItem>
                  ))}
                  <ToggleGroupItem value="erase" aria-label="Erase" title="Erase">
                    <Eraser />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Separator orientation="vertical" className="mx-1 h-6" />

                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={toolId}
                  onValueChange={(value) => value && setToolId(value)}
                >
                  {ATOM_TOOLS.map((el) => (
                    <ToggleGroupItem key={el} value={`atom:${el}`} aria-label={el} title={`Draw ${el}`}>
                      <span className="text-xs font-medium">{el}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <Separator orientation="vertical" className="mx-1 h-6" />

                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={toolId}
                  onValueChange={(value) => value && setToolId(value)}
                >
                  {STAMP_TOOLS.map((stamp) => (
                    <ToggleGroupItem
                      key={stamp}
                      value={`group:${stamp}`}
                      aria-label={GROUP_STAMPS[stamp].title}
                      title={`Add ${GROUP_STAMPS[stamp].title}`}
                    >
                      <span className="text-xs font-medium">{GROUP_STAMPS[stamp].label}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" title="Undo" onClick={undo} disabled={!past.length}>
                    <Undo2 />
                  </Button>
                  <Button variant="ghost" size="icon" title="Redo" onClick={redo} disabled={!future.length}>
                    <Redo2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Tidy up the drawing"
                    onClick={() => load(layout(molecule))}
                    disabled={!molecule.atoms.length}
                  >
                    <Sparkles />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Centre"
                    onClick={centreView}
                    disabled={!molecule.atoms.length}
                  >
                    <Crosshair />
                  </Button>
                  <Button
                    variant={showLabels ? "secondary" : "ghost"}
                    size="icon"
                    title="Show CH labels"
                    onClick={() => setShowLabels((value) => !value)}
                  >
                    <Tags />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" title="Clear" disabled={!molecule.atoms.length}>
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This wipes the structure you have drawn. Undo (⌘Z) still works afterwards.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep drawing</AlertDialogCancel>
                        <AlertDialogAction onClick={() => setMolecule(emptyMolecule())}>
                          Clear it
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {mode === "draw" ? (
                    <Select value="" onValueChange={(value) => load(moleculeFromSmiles(value))}>
                      <SelectTrigger size="sm" className="w-[168px]">
                        <SelectValue placeholder="Examples" />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {EXAMPLES.map((example) => (
                          <SelectItem key={example.smiles} value={example.smiles}>
                            {example.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>

              {playing ? (
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
                  {current?.kind === "name" && !answered ? (
                    <>
                      <Input
                        ref={nameInputRef}
                        autoFocus
                        value={answer}
                        placeholder="type the name…"
                        onChange={(event) => {
                          setAnswer(event.target.value);
                          setWrong(false);
                        }}
                        onKeyDown={(event) => event.key === "Enter" && submitAnswer()}
                        className={`h-8 max-w-xs ${wrong ? "border-destructive text-destructive" : ""}`}
                      />
                      <Button size="sm" onClick={submitAnswer} disabled={!answer.trim()}>
                        Check
                      </Button>
                      {wrong ? <span className="text-xs text-destructive">not quite — try again</span> : null}
                    </>
                  ) : null}

                  {current?.kind === "draw" && !answered ? (
                    <>
                      <Button
                        size="sm"
                        onClick={submitAnswer}
                        disabled={!molecule.atoms.length}
                      >
                        Submit
                      </Button>
                      {wrong ? <span className="text-xs text-destructive">not quite — try again</span> : null}
                    </>
                  ) : null}

                  {answered ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-emerald-700">
                        {wasCorrect ? "correct" : `it was ${targetName}`}
                      </span>
                      {wasCorrect && result.ok ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setBreakdownOpen(true)}
                        >
                          <ListOrdered />
                          Full breakdown
                        </Button>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        Enter for {index + 1 >= questions.length ? "results" : "next"}
                      </span>
                    </div>
                  ) : null}

                  <div className="ml-auto flex items-center gap-2">
                    {setup.pace === "casual" ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" title="Tweak settings">
                            <Settings2 />
                            Settings
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[340px]">
                          <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
                            Casual · changes apply to upcoming rounds
                          </p>
                          <ChallengeSetup setup={setup} onChange={applyCasualSetup} compact />
                        </PopoverContent>
                      </Popover>
                    ) : null}
                    {!answered ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          finish(false, true);
                          if (current?.kind === "draw" && current) {
                            resetCanvas(current.challenge.molecule);
                          }
                        }}
                      >
                        Give up
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={goNext} disabled={!answered}>
                      {index + 1 >= questions.length ? "See results" : "Next"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div ref={canvasRef} className="relative min-h-0 flex-1">
                <MoleculeCanvas
                  molecule={molecule}
                  onChange={handleDraw}
                  tool={tool}
                  highlight={highlight}
                  layers={layers}
                  guide={guide}
                  errorAtoms={result.ok ? undefined : result.atoms}
                  showLabels={showLabels}
                  readOnly={playing && current?.kind === "name"}
                  pan={pan}
                  zoom={zoom}
                  onPanChange={(next) => {
                    userPanned.current = true;
                    setPan(next);
                  }}
                  onZoomChange={(next) => {
                    userPanned.current = true;
                    setZoom(next);
                  }}
                />
                {layers?.length ? (
                  <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md border bg-background/90 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
                    {layers.map((layer) => (
                      <span key={`${layer.accent}-${layer.label}`} className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: HIGHLIGHT_COLOR[layer.accent] }}
                        />
                        {layer.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>

        {breakdownOpen && result.ok && showBreakdown ? (
          <BreakdownPanel
            steps={steps}
            active={activeStep}
            onSelect={setActive}
            onClose={() => setBreakdownOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
