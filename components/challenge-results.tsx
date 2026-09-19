"use client";

import { useState } from "react";
import { Check, Copy, ImageDown, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/chem/library";
import { copyCardToClipboard, formatTime, shareText, type ShareResult } from "@/lib/share-card";
import { cn } from "@/lib/utils";

const MARK_CLASS = {
  clean: "bg-emerald-600",
  hinted: "bg-amber-500",
  missed: "bg-red-600",
} as const;

const MARK_WORD = { clean: "no hints", hinted: "with hints", missed: "skipped" } as const;

type Props = {
  result: ShareResult;
  questions: Question[];
  onAgain: () => void;
  onNew: () => void;
};

export function ChallengeResults({ result, questions, onAgain, onNew }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const flash = (message: string) => {
    setCopied(message);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg space-y-5">
        <div className="rounded-xl border p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {result.mode} · {result.difficulty}
          </p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">{formatTime(result.ms)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.correct} of {result.total} named right · seed{" "}
            <span className="font-mono">{result.seed}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {result.marks.map((mark, i) => (
              <span key={i} className={cn("size-6 rounded-md", MARK_CLASS[mark])} />
            ))}
          </div>
        </div>

        <ol className="space-y-1">
          {questions.map((question, i) => (
            <li
              key={`${question.challenge.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className={cn("size-2.5 shrink-0 rounded-full", MARK_CLASS[result.marks[i] ?? "missed"])} />
              <span className="truncate">{question.challenge.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {question.kind === "draw" ? "drew" : "named"} · {MARK_WORD[result.marks[i] ?? "missed"]}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              const how = await copyCardToClipboard(result);
              flash(how === "copied" ? "Card copied" : "Card downloaded");
            }}
          >
            <ImageDown />
            Copy result card
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(shareText(result));
              flash("Summary copied");
            }}
          >
            <Copy />
            Copy summary
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(result.url);
              flash("Link copied");
            }}
          >
            <Copy />
            Copy link
          </Button>
          <Button variant="ghost" onClick={onAgain}>
            <RotateCcw />
            Same run again
          </Button>
          <Button variant="ghost" onClick={onNew}>
            <Shuffle />
            New run
          </Button>
          {copied ? (
            <span className="flex items-center gap-1 self-center text-xs text-muted-foreground">
              <Check className="size-3" />
              {copied}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
