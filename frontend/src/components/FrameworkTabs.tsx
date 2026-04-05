"use client";

import { Children, isValidElement, ReactElement, ReactNode, useMemo, useState } from "react";

type TabProps = {
  label: string;
  children: ReactNode;
};

type TabsProps = {
  children: ReactNode;
};

export function FrameworkTab({ children }: TabProps) {
  return <>{children}</>;
}

export function FrameworkTabs({ children }: TabsProps) {
  const tabs = useMemo(() => {
    const parsed = Children.toArray(children)
      .filter((child): child is ReactElement<TabProps> => isValidElement<TabProps>(child))
      .map((child) => ({
        label: child.props.label,
        content: child.props.children,
      }))
      .filter((tab) => typeof tab.label === "string" && tab.label.length > 0);

    return parsed;
  }, [children]);

  const [active, setActive] = useState(0);

  if (tabs.length === 0) return null;

  return (
    <div className="my-8 overflow-hidden rounded-2xl border border-[#E8E8E8] bg-white">
      <div className="flex flex-wrap gap-2 border-b border-[#E8E8E8] bg-[#F9F9F9] p-3">
        {tabs.map((tab, index) => (
          <button
            key={`${tab.label}-${index}`}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              index === active
                ? "bg-[#0A0A0A] text-white"
                : "bg-white text-[#6B6B6B] hover:text-[#0A0A0A]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-5 sm:p-6">{tabs[active]?.content}</div>
    </div>
  );
}
