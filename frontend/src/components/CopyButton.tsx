"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, type Variants } from "framer-motion";

interface CopyButtonProps {
    text: string;
    className?: string;
}

const glitchButtonVariants: Variants = {
    idle: {
        x: 0,
        y: 0,
        scale: 1,
        rotate: 0,
        boxShadow: "0 0 0 rgba(94, 242, 192, 0)",
        borderColor: "rgba(255,255,255,0.1)",
        transition: {
            duration: 0.24,
            ease: "easeOut"
        }
    },
    success: {
        x: [0, -1.5, 1.75, -1.25, 0.75, 0],
        y: [0, 0.5, -0.75, 0.5, 0, 0],
        scale: [1, 1.02, 0.985, 1.015, 1],
        rotate: [0, -1, 1, -0.5, 0],
        boxShadow: [
            "0 0 0 rgba(94, 242, 192, 0)",
            "0 0 18px rgba(94, 242, 192, 0.3)",
            "0 0 28px rgba(56, 189, 248, 0.28)",
            "0 0 22px rgba(94, 242, 192, 0.24)",
            "0 0 0 rgba(94, 242, 192, 0)"
        ],
        borderColor: [
            "rgba(255,255,255,0.1)",
            "rgba(94,242,192,0.55)",
            "rgba(56,189,248,0.45)",
            "rgba(94,242,192,0.45)",
            "rgba(255,255,255,0.1)"
        ],
        transition: {
            duration: 0.48,
            times: [0, 0.18, 0.38, 0.7, 1],
            ease: "easeInOut"
        }
    }
};

const glitchLayerVariants: Variants = {
    initial: {
        opacity: 0,
        x: 0,
        scaleX: 1
    },
    success: (xOffset: number) => ({
        opacity: [0, 0.75, 0.2, 0.55, 0],
        x: [0, xOffset, -xOffset * 0.8, xOffset * 0.45, 0],
        scaleX: [1, 1.06, 0.98, 1.02, 1],
        transition: {
            duration: 0.46,
            times: [0, 0.16, 0.42, 0.72, 1],
            ease: "easeInOut"
        }
    })
};

const iconGlitchVariants: Variants = {
    idle: {
        x: 0,
        filter: "drop-shadow(0 0 0 rgba(94, 242, 192, 0))"
    },
    success: {
        x: [0, -1, 1, -0.5, 0],
        filter: [
            "drop-shadow(0 0 0 rgba(94, 242, 192, 0))",
            "drop-shadow(0 0 6px rgba(94, 242, 192, 0.7))",
            "drop-shadow(0 0 10px rgba(56, 189, 248, 0.55))",
            "drop-shadow(0 0 6px rgba(94, 242, 192, 0.45))",
            "drop-shadow(0 0 0 rgba(94, 242, 192, 0))"
        ],
        transition: {
            duration: 0.4,
            times: [0, 0.18, 0.42, 0.72, 1],
            ease: "easeInOut"
        }
    }
};

export default function CopyButton({ text, className = "" }: CopyButtonProps) {
    const t = useTranslations("copyButton");
    const [copied, setCopied] = useState(false);
    const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (resetTimerRef.current) {
                clearTimeout(resetTimerRef.current);
            }
        };
    }, []);

    const showCopiedState = () => {
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
        }

        setCopied(true);
        resetTimerRef.current = setTimeout(() => {
            setCopied(false);
            resetTimerRef.current = null;
        }, 2000);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            showCopiedState();
        } catch {
            const el = document.createElement("textarea");
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            showCopiedState();
        }
    };

    return (
        <div className="relative inline-flex items-center">
            <motion.button
                onClick={handleCopy}
                aria-label={t("ariaLabel")}
                className={`relative overflow-hidden rounded-lg border border-white/10 bg-black/20 p-1.5 text-slate-400 transition-all hover:border-mint/40 hover:text-mint active:scale-95 ${className}`}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.05 }}
                variants={glitchButtonVariants}
                initial="idle"
                animate={copied ? "success" : "idle"}
            >
                <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,rgba(94,242,192,0.22),rgba(15,26,43,0.04)_45%,rgba(56,189,248,0.18))]"
                    variants={glitchLayerVariants}
                    initial="initial"
                    animate={copied ? "success" : "initial"}
                    custom={2.5}
                />
                <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-[10%] top-[18%] h-px rounded-full bg-cyan-300/80 mix-blend-screen"
                    variants={glitchLayerVariants}
                    initial="initial"
                    animate={copied ? "success" : "initial"}
                    custom={3.5}
                />
                <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-[16%] bottom-[24%] h-px rounded-full bg-rose-400/70 mix-blend-screen"
                    variants={glitchLayerVariants}
                    initial="initial"
                    animate={copied ? "success" : "initial"}
                    custom={-2.75}
                />
                <motion.span
                    className="relative z-10 block"
                    variants={iconGlitchVariants}
                    initial="idle"
                    animate={copied ? "success" : "idle"}
                >
                    <AnimatePresence mode="wait">
                        {copied ? (
                            <motion.svg
                                key="checkmark"
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4 text-mint"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                initial={{ scale: 0, rotate: -180, opacity: 0 }}
                                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                                exit={{ scale: 0, rotate: 180, opacity: 0 }}
                                transition={{
                                    type: "spring",
                                    stiffness: 300,
                                    damping: 20,
                                    duration: 0.4
                                }}
                            >
                                <motion.polyline
                                    points="20 6 9 17 4 12"
                                    initial={{ pathLength: 0 }}
                                    animate={{ pathLength: 1 }}
                                    transition={{
                                        pathLength: { delay: 0.2, duration: 0.3, ease: "easeInOut" }
                                    }}
                                />
                            </motion.svg>
                        ) : (
                            <motion.svg
                                key="clipboard"
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                initial={{ scale: 1, opacity: 1 }}
                                animate={{ scale: copied ? 0 : 1, opacity: copied ? 0 : 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                transition={{
                                    duration: 0.2,
                                    ease: "easeInOut"
                                }}
                            >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </motion.svg>
                        )}
                    </AnimatePresence>
                </motion.span>
            </motion.button>
            <AnimatePresence>
                {copied && (
                    <motion.span
                        initial={{ opacity: 0, y: 10, scale: 0.8 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.8 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-mint/30 bg-tide px-2 py-1 font-mono text-xs text-mint shadow-lg"
                    >
                        {t("copied")}
                    </motion.span>
                )}
            </AnimatePresence>
        </div>
    );
}
