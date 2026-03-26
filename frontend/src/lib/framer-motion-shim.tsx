import { createElement, Fragment, type ReactNode } from "react";

type MotionProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

function createMotionComponent(tag: string) {
  return function MotionShim({ children, ...props }: MotionProps) {
    return createElement(tag, props, children);
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
