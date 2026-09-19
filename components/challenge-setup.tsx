"use client";

import { Dices, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  GROUP_OPTIONS,
  type ChallengeMode,
  type Difficulty,
  type GroupOption,
  type RunPace,
  type RunSetup,
} from "@/lib/chem/library";
import { makeSeed } from "@/lib/chem/rng";

const MODES: { id: ChallengeMode; label: string; note: string }[] = [
  { id: "draw", label: "Draw it", note: "you get the name" },
  { id: "name", label: "Name it", note: "you get the structure" },
  { id: "mixed", label: "Mixed", note: "a bit of both" },
];

const LEVELS: { id: Difficulty; label: string; note?: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
  { id: "bs", label: "BS", note: "chaotic nonsense" },
];

const PACES: { id: RunPace; label: string; note: string }[] = [
  { id: "strict", label: "Strict", note: "settings lock in" },
  { id: "casual", label: "Casual", note: "tweak as you go" },
];

const ROUNDS = [5, 10, 15];

type Props = {
  setup: RunSetup;
  onChange: (next: RunSetup) => void;
  onStart?: () => void;
  shared?: boolean;
  /** Compact panel used mid-run in casual mode. */
  compact?: boolean;
};

export function ChallengeSetup({ setup, onChange, onStart, shared, compact }: Props) {
  const set = (patch: Partial<RunSetup>) => onChange({ ...setup, ...patch });

  const body = (
    <>
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mode</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={setup.mode}
          onValueChange={(value) => value && set({ mode: value as ChallengeMode })}
          className="w-full"
        >
          {MODES.map((mode) => (
            <ToggleGroupItem key={mode.id} value={mode.id} className="h-auto flex-1 flex-col py-2">
              <span className="text-sm font-medium">{mode.label}</span>
              <span className="text-[11px] text-muted-foreground">{mode.note}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pace</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={setup.pace}
          onValueChange={(value) => value && set({ pace: value as RunPace })}
          className="w-full"
        >
          {PACES.map((pace) => (
            <ToggleGroupItem key={pace.id} value={pace.id} className="h-auto flex-1 flex-col py-2">
              <span className="text-sm font-medium">{pace.label}</span>
              <span className="text-[11px] text-muted-foreground">{pace.note}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className={compact ? "space-y-4" : "grid grid-cols-2 gap-4"}>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Level</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={setup.difficulty}
            onValueChange={(value) => value && set({ difficulty: value as Difficulty })}
            className="flex w-full flex-wrap"
          >
            {LEVELS.map((level) => (
              <ToggleGroupItem
                key={level.id}
                value={level.id}
                className="min-w-[4.5rem] flex-1"
                title={level.note}
              >
                {level.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {setup.difficulty === "bs" ? (
            <p className="text-[11px] text-muted-foreground">
              Absurd chains, stacked groups, names that hurt.
            </p>
          ) : null}
        </div>
        {!compact ? (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rounds</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(setup.count)}
              onValueChange={(value) => value && set({ count: Number(value) })}
            >
              {ROUNDS.map((count) => (
                <ToggleGroupItem key={count} value={String(count)} className="flex-1">
                  {count}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}
      </div>

      <div className={compact ? "space-y-4" : "grid grid-cols-2 gap-4"}>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Groups</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span>{setup.groups.length} selected</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[300px]">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">What can show up</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ groups: GROUP_OPTIONS.map((option) => option.id) })}
                >
                  All
                </Button>
              </div>
              <div className="grid max-h-[320px] gap-1 overflow-y-auto">
                {GROUP_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={setup.groups.includes(option.id)}
                      onCheckedChange={(checked) =>
                        set({
                          groups: checked
                            ? [...setup.groups, option.id]
                            : setup.groups.filter((id: GroupOption) => id !== option.id),
                        })
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {!compact ? (
          <div className="space-y-2">
            <Label htmlFor="seed" className="text-xs uppercase tracking-wider text-muted-foreground">
              Seed
            </Label>
            <div className="flex gap-2">
              <Input
                id="seed"
                value={setup.seed}
                onChange={(event) => set({ seed: event.target.value.toUpperCase().slice(0, 10) })}
                className="font-mono uppercase"
              />
              <Button variant="outline" size="icon" title="New seed" onClick={() => set({ seed: makeSeed() })}>
                <Dices />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {onStart ? (
        <Button className="w-full" size="lg" onClick={onStart} disabled={!setup.seed.trim()}>
          <Play />
          Start {setup.count} rounds
        </Button>
      ) : null}
    </>
  );

  if (compact) {
    return <div className="space-y-4 p-1">{body}</div>;
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg space-y-5">
        <div>
          <h2 className="text-lg font-semibold">
            {shared ? "A run was shared with you" : "Set up a run"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {shared
              ? "Same seed, same molecules — see how your time compares."
              : "Pick how you want to practise, then share the link to race a friend."}
          </p>
        </div>
        {body}
      </div>
    </div>
  );
}
