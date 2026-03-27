"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;


interface DropdownMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
  className?: string;
}

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className = "", sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={[
        "z-50 min-w-[10rem] overflow-hidden",
        "rounded-xl border border-white/10",
        "bg-black/80 backdrop-blur p-1",
        "shadow-xl shadow-black/40",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-2",
        "data-[side=top]:slide-in-from-bottom-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;



interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  className?: string;
  inset?: boolean;
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className = "", inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={[
      "relative flex cursor-default select-none items-center gap-2",
      "rounded-lg px-3 py-2 text-sm outline-none transition-colors",
      "text-slate-300",
      "focus:bg-white/10 focus:text-white",
      "data-[highlighted]:bg-white/10 data-[highlighted]:text-white",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      inset ? "pl-8" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    className?: string;
    inset?: boolean;
  }
>(({ className = "", inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={[
      "px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500",
      inset ? "pl-8" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator> & {
    className?: string;
  }
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={["-mx-1 my-1 h-px bg-white/10", className]
      .filter(Boolean)
      .join(" ")}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export function DropdownMenuShortcut({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={[
        "ml-auto text-xs tracking-widest text-slate-500",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
