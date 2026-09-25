import { createElement, Fragment, useEffect, useState, type ReactNode } from "react";

type MotionProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

const MOTION_PROPS = [
  "initial",
  "animate",
  "exit",
  "transition",
  "viewport",
  "whileInView",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "variants",
  "layout",
  "layoutId",
  "onAnimationStart",
  "onAnimationComplete",
  "onUpdate",
  "custom",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "dragListener",
  "dragControls",
  "onDragStart",
  "onDragEnd",
  "onDrag",
  "onDirectionLock",
  "onDragTransitionEnd",
];

function createMotionComponent(tag: string) {
  return function MotionShim({ children, ...props }: MotionProps) {
    const cleanProps = { ...props };
    MOTION_PROPS.forEach((prop) => {
      delete cleanProps[prop];
    });

    return createElement(tag, cleanProps, children);
  };
}

export const motion = new Proxy(
  {},
  {
    get(_target, tag: string) {
      return createMotionComponent(tag);
    },
  }
) as Record<string, (props: MotionProps) => ReturnType<typeof createElement>>;

export function AnimatePresence({ children }: { children?: ReactNode }) {
  return <Fragment>{children}</Fragment>;
}

export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}
