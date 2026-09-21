"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { Eraser, Hash } from "lucide-react";

/** Soft inks — meanings are yours alone. */
export const MARK_INKS = [
  "#5b7c99",
  "#c4a35a",
  "#6a9b7a",
  "#b07a8c",
  "#7a6fa0",
] as const;

export type MarkInk = (typeof MARK_INKS)[number];

export type MarkTool =
  | { kind: "number" }
  | { kind: "ink"; color: MarkInk }
  | { kind: "wipe" };

export type Annotations = {
  numbers: Record<string, number>;
  inks: Record<string, string>;
};

export const EMPTY_ANNOTATIONS: Annotations = { numbers: {}, inks: {} };

type Props = {
  tool: MarkTool | null;
  onToolChange: (tool: MarkTool | null) => void;
  hasMarks: boolean;
  onClear: () => void;
  className?: string;
};

export function AnnotationBar({ tool, onToolChange, hasMarks, onClear, className }: Props) {
  const value =
    tool?.kind === "number" ? "number" : tool?.kind === "wipe" ? "wipe" : tool?.kind === "ink" ? tool.color : "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-muted-foreground",
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-wider">Marks</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(next) => {
          if (!next) {
            onToolChange(null);
            return;
          }
          if (next === "number") onToolChange({ kind: "number" });
          else if (next === "wipe") onToolChange({ kind: "wipe" });
          else onToolChange({ kind: "ink", color: next as MarkInk });
        }}
      >
        <ToggleGroupItem value="number" aria-label="Number carbons" title="Number carbons">
          <Hash className="size-3.5" />
        </ToggleGroupItem>
        {MARK_INKS.map((color) => (
          <ToggleGroupItem
            key={color}
            value={color}
            aria-label="Highlight bonds"
            title="Highlight a bond"
            className="px-1.5"
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem value="wipe" aria-label="Erase marks" title="Erase marks">
          <Eraser className="size-3.5" />
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        disabled={!hasMarks}
        onClick={onClear}
      >
        Clear marks
      </Button>
    </div>
  );
}
