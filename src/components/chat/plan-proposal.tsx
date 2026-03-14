"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Info, ArrowRight, Circle, Check, ChevronLeft, ChevronRight, MessageSquare, Send, PenLine, Mic, Square, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVoiceInput } from "./use-voice-input";

// ── Types ──────────────────────────────────────────────────────

interface PlanOption {
  label: string;
  description: string;
}

interface PlanSection {
  dimension: string;
  choices: string[];
}

interface PlanProposalProps {
  summary: string;
  options?: PlanOption[];
  sections?: PlanSection[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  voiceEnabled?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function PlanProposal({ summary, options, sections, onSelect, disabled, voiceEnabled }: PlanProposalProps) {
  const useSections = sections && sections.length >= 2;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Summary */}
      <div className="flex items-start gap-3 p-4">
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0 mt-0.5">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-72 text-xs">
            <p className="font-medium mb-1.5">Interactive planning</p>
            <p className="text-muted-foreground leading-relaxed">
              This form lets you guide the agent's approach before it starts working. Your choices shape the plan, so pick what matters most to you.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-1.5">
              You can disable this in <span className="text-foreground font-medium">Settings &gt; System Agents &gt; Planner</span>.
            </p>
          </PopoverContent>
        </Popover>
        <p className="text-sm text-foreground">{summary}</p>
      </div>

      {useSections ? (
        <SectionedForm sections={sections} onSelect={onSelect} disabled={disabled} voiceEnabled={voiceEnabled} />
      ) : options ? (
        <LegacyOptions options={options} onSelect={onSelect} disabled={disabled} />
      ) : null}
    </div>
  );
}

// ── Sectioned Form (new) ───────────────────────────────────────

function SectionedForm({ sections, onSelect, disabled, voiceEnabled }: {
  sections: PlanSection[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  voiceEnabled?: boolean;
}) {
  const totalSteps = sections.length + 1; // sections + final confirm
  const [step, setStep] = useState(disabled ? sections.length : 0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [animTarget, setAnimTarget] = useState<number | null>(null);

  const isLocked = submitted || disabled;
  const animating = animTarget !== null;

  const slideTo = useCallback((target: number) => {
    setAnimTarget(target);
    // Allow CSS transition to play, then update actual step
    setTimeout(() => {
      setStep(target);
      setAnimTarget(null);
    }, 200);
  }, []);

  const handleChoice = (dimension: string, choice: string) => {
    if (isLocked || animating) return;
    setSelections((prev) => ({ ...prev, [dimension]: choice }));
    setCustomTexts((prev) => ({ ...prev, [dimension]: "" }));
    slideTo(step + 1);
  };

  const handleCustomChoice = (dimension: string, directText?: string) => {
    const text = (directText ?? customTexts[dimension])?.trim();
    if (isLocked || animating || !text) return;
    setSelections((prev) => ({ ...prev, [dimension]: text }));
    if (directText) setCustomTexts((prev) => ({ ...prev, [dimension]: text }));
    slideTo(step + 1);
  };

  const handleSubmit = () => {
    if (isLocked) return;
    setSubmitted(true);
    const parts = sections.map((s) => `${s.dimension}: ${selections[s.dimension]}`);
    let text = parts.join("\n");
    onSelect(text);
  };

  // After submit or on page reload, hide the form — choices are in the user chat bubble
  if (disabled || submitted) return null;

  // Target step for the CSS transform (animating slides to the target immediately)
  const visibleStep = animTarget !== null ? animTarget : step;

  return (
    <div className="overflow-hidden border-t border-border/50">
      {/* Sliding panels */}
      <div
        className="flex transition-transform duration-200 ease-out"
        style={{ transform: `translateX(-${visibleStep * 100}%)` }}
      >
        {/* One panel per section */}
        {sections.map((section, i) => {
          const chosen = selections[section.dimension];
          const customVal = customTexts[section.dimension] || "";
          return (
            <div key={section.dimension} className="w-full shrink-0 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase px-1">
                {section.dimension}
              </p>

              {section.choices.map((choice) => {
                const isChosen = chosen === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={animating}
                    onClick={() => handleChoice(section.dimension, choice)}
                    className={cn(
                      "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
                      isChosen
                        ? "border-foreground/30 bg-foreground/5 text-foreground"
                        : chosen
                          ? "border-border/30 text-muted-foreground/40 cursor-pointer"
                          : "border-border hover:border-foreground/20 hover:bg-foreground/5 cursor-pointer",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {isChosen
                        ? <Check className="h-4 w-4 shrink-0 text-foreground" />
                        : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />}
                      <span className="text-sm font-medium">{choice}</span>
                    </div>
                  </button>
                );
              })}

              {/* Custom text option (last row) */}
              <CustomTextRow
                dimension={section.dimension}
                chosen={chosen}
                choices={section.choices}
                customVal={customVal}
                onChangeCustom={(val) => setCustomTexts((prev) => ({ ...prev, [section.dimension]: val }))}
                onSubmitCustom={(directText?: string) => handleCustomChoice(section.dimension, directText)}
                disabled={animating}
                voiceEnabled={voiceEnabled}
              />
            </div>
          );
        })}

        {/* Final panel: recap + confirm */}
        <div className="w-full shrink-0 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase px-1">
            Your choices
          </p>

          {/* Chosen summary */}
          <div className="space-y-2">
            {sections.map((s) => (
              <div key={s.dimension} className="px-1">
                <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{s.dimension}</span>
                <p className="text-sm text-foreground truncate">{selections[s.dimension]}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation: back/forward + dots */}
      {!submitted && (
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Back */}
          <button
            type="button"
            disabled={step === 0 || animating}
            onClick={() => slideTo(step - 1)}
            className={cn(
              "flex items-center gap-1 text-xs transition-colors",
              step === 0
                ? "text-muted-foreground/20 cursor-default"
                : "text-muted-foreground hover:text-foreground cursor-pointer",
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <button
                key={i}
                type="button"
                disabled={animating}
                onClick={() => {
                  // Only allow navigating to steps that have been completed or are current
                  if (i <= step) slideTo(i);
                }}
                className={cn(
                  "rounded-full transition-colors",
                  i === step
                    ? "h-2 w-2 bg-foreground/70"
                    : i < step
                      ? "h-1.5 w-1.5 bg-foreground/30 hover:bg-foreground/50 cursor-pointer"
                      : "h-1.5 w-1.5 bg-muted-foreground/20",
                )}
              />
            ))}
          </div>

          {/* Forward / Confirm */}
          {step >= totalSteps - 1 ? (
            <button
              type="button"
              disabled={animating}
              onClick={handleSubmit}
              className="flex items-center gap-1 text-xs text-foreground hover:text-foreground/70 transition-colors cursor-pointer"
            >
              Confirm
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!selections[sections[step]?.dimension] || animating}
              onClick={() => slideTo(step + 1)}
              className={cn(
                "flex items-center gap-1 text-xs transition-colors",
                !selections[sections[step]?.dimension]
                  ? "text-muted-foreground/20 cursor-default"
                  : "text-muted-foreground hover:text-foreground cursor-pointer",
              )}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

    </div>
  );
}

// ── Custom Text Row (with optional voice) ─────────────────────

function CustomTextRow({ dimension, chosen, choices, customVal, onChangeCustom, onSubmitCustom, disabled, voiceEnabled }: {
  dimension: string;
  chosen: string | undefined;
  choices: string[];
  customVal: string;
  onChangeCustom: (val: string) => void;
  onSubmitCustom: (directText?: string) => void;
  disabled?: boolean;
  voiceEnabled?: boolean;
}) {
  const isCustomChosen = !!chosen && !choices.includes(chosen);

  const { isRecording, isTranscribing, toggleRecording } = useVoiceInput({
    onTranscript: (text) => {
      const existing = customVal.trim();
      const full = existing ? existing + " " + text : text;
      onChangeCustom(full);
      onSubmitCustom(full);
    },
  });

  return (
    <div className={cn(
      "flex items-center gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
      isCustomChosen
        ? "border-foreground/30 bg-foreground/5"
        : "border-border",
    )}>
      {isCustomChosen
        ? <Check className="h-4 w-4 shrink-0 text-foreground" />
        : <PenLine className="h-4 w-4 shrink-0 text-muted-foreground/30" />}
      <input
        type="text"
        value={customVal}
        onChange={(e) => onChangeCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmitCustom();
        }}
        onBlur={() => {
          if (customVal.trim() && !isRecording) onSubmitCustom();
        }}
        placeholder="Something else..."
        className="flex-1 bg-transparent text-sm py-0 px-0 outline-none placeholder:text-muted-foreground/40"
        disabled={disabled}
      />
      {voiceEnabled && (
        <button
          type="button"
          onClick={toggleRecording}
          disabled={disabled}
          className={cn(
            "shrink-0 transition-colors",
            isRecording
              ? "text-red-400 hover:text-red-300 animate-pulse"
              : isTranscribing
                ? "text-muted-foreground/40"
                : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
        >
          {isTranscribing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : isRecording
              ? <Square className="h-3.5 w-3.5 fill-current" />
              : <Mic className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

// ── Legacy Options (backward compat) ───────────────────────────

function LegacyOptions({ options, onSelect, disabled }: {
  options: PlanOption[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}) {
  const [customText, setCustomText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const isLocked = !!selected || disabled;

  const handleOptionClick = (option: PlanOption) => {
    if (isLocked) return;
    setSelected(option.label);
    onSelect(option.label);
  };

  const handleCustomSubmit = () => {
    if (isLocked || !customText.trim()) return;
    setSelected(customText.trim());
    onSelect(customText.trim());
  };

  return (
    <div className="p-3 space-y-2 border-t border-border/50">
      <p className="text-xs font-medium text-muted-foreground uppercase px-1">
        How would you like to approach this?
      </p>
      {options.map((option, i) => {
        const isThis = selected === option.label;
        return (
          <button
            key={i}
            type="button"
            disabled={isLocked && !isThis}
            onClick={() => handleOptionClick(option)}
            className={cn(
              "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
              isThis
                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
                : isLocked
                  ? "border-border/30 bg-transparent text-muted-foreground/40 cursor-default"
                  : "border-border hover:border-cyan-500/30 hover:bg-cyan-500/5 cursor-pointer",
            )}
          >
            <div className="flex items-center gap-2">
              <ArrowRight className={cn(
                "h-3.5 w-3.5 shrink-0",
                isThis ? "text-cyan-400" : "text-muted-foreground/50",
              )} />
              <div className="min-w-0">
                <span className="text-sm font-medium">{option.label}</span>
                <p className={cn(
                  "text-xs mt-0.5",
                  isThis ? "text-cyan-400/70" : "text-muted-foreground",
                )}>
                  {option.description}
                </p>
              </div>
            </div>
          </button>
        );
      })}

      {!isLocked && (
        <div className="flex items-center gap-2 pt-1">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCustomSubmit();
            }}
            placeholder="Or tell me what matters most to you..."
            className="flex-1 bg-transparent border-b border-border/50 focus:border-cyan-500/50 text-sm py-1 px-0 outline-none placeholder:text-muted-foreground/40 transition-colors"
            disabled={isLocked}
          />
          {customText.trim() && (
            <button
              type="button"
              onClick={handleCustomSubmit}
              className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors shrink-0"
            >
              Send
            </button>
          )}
        </div>
      )}

      {selected && (
        <p className="text-xs text-muted-foreground/50 px-1 pt-1">
          Working on it...
        </p>
      )}
    </div>
  );
}
