"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CopyButtonProps {
    text: string;
    className?: string;
}

export default function CopyButton({ text, className = "" }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const el = document.createElement("textarea");
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="relative inline-flex items-center">
            <motion.button
                onClick={handleCopy}
                aria-label="Copy to clipboard"
                className={`rounded-lg border border-white/10 p-1.5 text-slate-400 transition-all hover:border-mint/40 hover:text-mint active:scale-95 ${className}`}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.05 }}
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
                        Copied!
                    </motion.span>
                )}
            </AnimatePresence>
        </div>
    );
}
