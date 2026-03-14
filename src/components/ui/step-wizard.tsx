"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface StepWizardProps {
  step: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function StepWizard({ step, children: childrenProp, footer, className, contentClassName }: StepWizardProps) {
  const children = React.Children.toArray(childrenProp);
  const [displayed, setDisplayed] = useState(step);
  const [target, setTarget] = useState(step);
  const [sliding, setSliding] = useState(false);

  useEffect(() => {
    if (step === target) return;
    setTarget(step);
    setSliding(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSliding(true));
    });
  }, [step, target]);

  function handleTransitionEnd(e: React.TransitionEvent) {
    if (e.propertyName !== "transform") return;
    setDisplayed(target);
    setSliding(false);
  }

  const animating = target !== displayed;
  const forward = target > displayed;

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      <div className={cn("overflow-hidden", contentClassName)}>
        {animating ? (
          <div
            className={sliding ? "transition-transform duration-300 ease-in-out" : ""}
            style={{
              display: "flex",
              width: "200%",
              transform: `translateX(${sliding ? (forward ? -50 : 0) : (forward ? 0 : -50)}%)`,
            }}
            onTransitionEnd={handleTransitionEnd}
          >
            <div className="w-1/2 shrink-0 min-w-0 overflow-hidden">
              {children[forward ? displayed : target]}
            </div>
            <div className="w-1/2 shrink-0 min-w-0 overflow-hidden">
              {children[forward ? target : displayed]}
            </div>
          </div>
        ) : (
          children[displayed]
        )}
      </div>
      {footer && <div className="border-t border-border">{footer}</div>}
    </div>
  );
}
