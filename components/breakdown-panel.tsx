"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Step } from "@/lib/chem/explain";
import { cn } from "@/lib/utils";

type Props = {
  steps: Step[];
  active: number;
  onSelect: (index: number) => void;
  onClose: () => void;
};

export function BreakdownPanel({ steps, active, onSelect, onClose }: Props) {
  return (
    <aside className="flex h-full min-h-0 w-[min(350px,100%)] shrink-0 flex-col overflow-hidden border-l bg-background">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold">Breakdown</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close breakdown">
          <X />
        </Button>
      </div>
      <Separator className="shrink-0" />
      <ScrollArea className="min-h-0 flex-1">
        <ol className="flex flex-col gap-1 p-3">
          {steps.map((step, index) => {
            const isActive = index === active;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onMouseEnter={() => onSelect(index)}
                  onFocus={() => onSelect(index)}
                  onClick={() => onSelect(index)}
                  className={cn(
                    "w-full min-w-0 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors",
                    isActive ? "border-border bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 text-sm font-medium break-words">{step.title}</span>
                    {step.chip ? (
                      <Badge variant="secondary" className="max-w-[40%] shrink-0 truncate font-mono text-[11px]">
                        {step.chip}
                      </Badge>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      "mt-1 text-xs leading-relaxed break-words text-muted-foreground",
                      isActive ? "" : "line-clamp-2",
                    )}
                  >
                    {step.detail}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
      <Separator className="shrink-0" />
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Step {Math.min(active + 1, steps.length)} of {steps.length}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={active <= 0}
            onClick={() => onSelect(Math.max(0, active - 1))}
            aria-label="Previous step"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={active >= steps.length - 1}
            onClick={() => onSelect(Math.min(steps.length - 1, active + 1))}
            aria-label="Next step"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </aside>
  );
}
