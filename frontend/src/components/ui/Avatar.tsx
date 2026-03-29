"use client";

import React from "react";
import Image from "next/image";

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, src, size = 40, className = "" }: AvatarProps) {
  const getInitials = (str: string) => {
    const parts = str.split(" ").filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) {
      const s = parts[0];
      if (s.length >= 2) return s.substring(0, 2).toUpperCase();
      return s.toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getColor = (str: string) => {
    const colors = [
      { bg: "hsl(210, 80%, 60%)", text: "hsl(210, 80%, 98%)" },
      { bg: "hsl(160, 70%, 45%)", text: "hsl(160, 70%, 98%)" },
      { bg: "hsl(260, 70%, 65%)", text: "hsl(260, 70%, 98%)" },
      { bg: "hsl(340, 75%, 60%)", text: "hsl(340, 75%, 98%)" },
      { bg: "hsl(200, 80%, 50%)", text: "hsl(200, 80%, 98%)" },
      { bg: "hsl(280, 65%, 55%)", text: "hsl(280, 65%, 98%)" },
      { bg: "hsl(180, 75%, 40%)", text: "hsl(180, 75%, 98%)" },
      { bg: "hsl(230, 70%, 60%)", text: "hsl(230, 70%, 98%)" },
    ];

    let hash = 0;
    const s = str || "default";
    for (let i = 0; i < s.length; i++) {
      hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const initials = getInitials(name);
  const color = getColor(name);

  const containerStyle: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "9999px",
    overflow: "hidden",
    flexShrink: 0,
  };

  if (src) {
    return (
      <div 
        className={`bg-slate-800 border border-white/10 ${className}`}
        style={containerStyle}
      >
        <Image
          src={src}
          alt={name}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`font-semibold tracking-tight shadow-sm relative group select-none ${className}`}
      style={{
        ...containerStyle,
        backgroundColor: color.bg,
        color: color.text,
        fontSize: `${size / 2.6}px`,
        textShadow: "0 1px 2px rgba(0,0,0,0.1)",
      }}
      aria-label={name}
    >
      <span className="relative z-10 leading-none">{initials}</span>
      
      <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent opacity-40 pointer-events-none" />
      <div className="absolute inset-0 rounded-full border border-white/20 pointer-events-none" />
      
      <div className="absolute inset-0 bg-white/0 transition-colors group-hover:bg-white/10 pointer-events-none" />
    </div>
  );
}
