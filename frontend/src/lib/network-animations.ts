import { type Variants, type Transition } from "framer-motion";

/**
 * Enhanced animation variants for Network Status Indicator
 * Provides smooth, accessible, and performant animations
 */

// Base transition configuration for consistent timing
export const baseTransition: Transition = {
  duration: 0.3,
  ease: [0.16, 1, 0.3, 1], // Custom easing for smooth feel
};

// Status dot animation variants
export const statusDotVariants: Variants = {
  online: {
    scale: [1, 1.2, 1],
    opacity: [0.8, 1, 0.8],
    backgroundColor: ["rgb(34, 197, 94)", "rgb(22, 163, 74)", "rgb(34, 197, 94)"],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  offline: {
    scale: 1,
    opacity: 1,
    backgroundColor: "rgb(239, 68, 68)",
    transition: baseTransition,
  },
  slow: {
    scale: [1, 1.1, 1],
    opacity: [0.6, 1, 0.6],
    backgroundColor: ["rgb(250, 204, 21)", "rgb(234, 179, 8)", "rgb(250, 204, 21)"],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  checking: {
    scale: [1, 1.15, 1],
    opacity: [0.4, 1, 0.4],
    rotate: [0, 180, 360],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: "linear",
    },
  },
};

// Pulse animation for status indicators
export const pulseVariants: Variants = {
  pulse: {
    scale: [1, 1.05, 1],
    opacity: [0.7, 1, 0.7],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  none: {
    scale: 1,
    opacity: 1,
  },
};

// Status badge animation variants
export const statusBadgeVariants: Variants = {
  hidden: { 
    opacity: 0, 
    y: -10, 
    scale: 0.9 
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      ...baseTransition,
      staggerChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.9,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

// Details panel animation variants
export const detailsPanelVariants: Variants = {
  hidden: { 
    opacity: 0, 
    height: 0, 
    scale: 0.95 
  },
  visible: {
    opacity: 1,
    height: "auto",
    scale: 1,
    transition: {
      ...baseTransition,
      height: {
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    scale: 0.95,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

// Refresh button animation variants
export const refreshButtonVariants: Variants = {
  idle: {
    rotate: 0,
    scale: 1,
  },
  hover: {
    scale: 1.05,
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
  tap: {
    scale: 0.95,
    transition: {
      duration: 0.1,
      ease: "easeInOut",
    },
  },
  spinning: {
    rotate: 360,
    transition: {
      duration: 1,
      ease: "linear",
      repeat: Infinity,
    },
  },
};

// Latency indicator animation variants
export const latencyVariants: Variants = {
  good: {
    color: "rgb(34, 197, 94)",
    scale: 1,
  },
  warning: {
    color: "rgb(250, 204, 21)",
    scale: [1, 1.1, 1],
    transition: {
      duration: 0.5,
      repeat: 2,
      ease: "easeInOut",
    },
  },
  bad: {
    color: "rgb(239, 68, 68)",
    scale: [1, 1.2, 1],
    transition: {
      duration: 0.3,
      repeat: 3,
      ease: "easeInOut",
    },
  },
};

// Connection quality indicator animation
export const connectionQualityVariants: Variants = {
  excellent: {
    backgroundColor: "rgb(34, 197, 94)",
    width: "100%",
  },
  good: {
    backgroundColor: "rgb(134, 239, 172)",
    width: "75%",
  },
  fair: {
    backgroundColor: "rgb(250, 204, 21)",
    width: "50%",
  },
  poor: {
    backgroundColor: "rgb(239, 68, 68)",
    width: "25%",
  },
};

// Error message animation variants
export const errorMessageVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -10,
    scale: 0.9,
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: baseTransition,
  },
  exit: {
    opacity: 0,
    x: 10,
    scale: 0.9,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

// Container animation variants
export const containerVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.1,
    },
  },
};

// Staggered children animation for list items
export const staggeredChildrenVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -20,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: baseTransition,
  },
};

// Loading skeleton animation
export const skeletonVariants: Variants = {
  loading: {
    opacity: [0.3, 0.7, 0.3],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  loaded: {
    opacity: 1,
  },
};

// Notification animation variants
export const notificationVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -50,
    scale: 0.8,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 30,
    },
  },
  exit: {
    opacity: 0,
    y: -50,
    scale: 0.8,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

// Progress bar animation variants
export const progressBarVariants: Variants = {
  hidden: {
    width: 0,
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: "easeOut",
    },
  },
  progress: (progress: number) => ({
    width: `${progress}%`,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

// Hover effect variants for interactive elements
export const hoverEffectVariants: Variants = {
  rest: {
    scale: 1,
    backgroundColor: "transparent",
  },
  hover: {
    scale: 1.02,
    backgroundColor: "rgba(59, 130, 246, 0.05)",
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
};

// Focus ring animation variants
export const focusRingVariants: Variants = {
  unfocused: {
    scale: 0.8,
    opacity: 0,
  },
  focused: {
    scale: 1.2,
    opacity: 1,
    transition: {
      duration: 0.2,
      ease: "easeOut",
    },
  },
};

// Animation utility functions
export const getLatencyVariant = (latency: number | null): keyof typeof latencyVariants => {
  if (latency === null) return "good";
  if (latency < 100) return "good";
  if (latency < 300) return "warning";
  return "bad";
};

export const getConnectionQualityVariant = (latency: number | null): keyof typeof connectionQualityVariants => {
  if (latency === null) return "poor";
  if (latency < 50) return "excellent";
  if (latency < 150) return "good";
  if (latency < 300) return "fair";
  return "poor";
};

export const getStatusDotVariant = (status: string): keyof typeof statusDotVariants => {
  const validStatuses = ["online", "offline", "slow", "checking"];
  return validStatuses.includes(status) ? status as keyof typeof statusDotVariants : "checking";
};

// Animation hooks for reduced motion support
export const useReducedMotion = () => {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

// Adaptive transition configuration
export const getAdaptiveTransition = (baseTransition: Transition): Transition => {
  if (useReducedMotion()) {
    return {
      ...baseTransition,
      duration: 0.1,
      ease: "linear",
    };
  }
  return baseTransition;
};
