import { useCallback, useRef, useEffect } from "react";

/**
 * Performance monitoring utilities for Network Status Indicator animations
 * Ensures smooth, accessible, and performant animations
 */

export function useAnimationPerformance() {
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const animationStartTimeRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);

  const startAnimation = useCallback(() => {
    animationStartTimeRef.current = performance.now();
    isAnimatingRef.current = true;
    frameCountRef.current = 0;
  }, []);

  const endAnimation = useCallback(() => {
    if (isAnimatingRef.current) {
      const duration = performance.now() - animationStartTimeRef.current;
      const fps = frameCountRef.current / (duration / 1000);
      
      isAnimatingRef.current = false;
      
      return {
        duration,
        fps,
        frameCount: frameCountRef.current,
      };
    }
    return null;
  }, []);

  const trackFrame = useCallback(() => {
    if (isAnimatingRef.current) {
      frameCountRef.current++;
      lastFrameTimeRef.current = performance.now();
    }
  }, []);

  const getPerformanceMetrics = useCallback(() => {
    const now = performance.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;
    
    return {
      frameCount: frameCountRef.current,
      isAnimating: isAnimatingRef.current,
      timeSinceLastFrame,
      estimatedFPS: timeSinceLastFrame > 0 ? 1000 / timeSinceLastFrame : 0,
    };
  }, []);

  return {
    startAnimation,
    endAnimation,
    trackFrame,
    getPerformanceMetrics,
  };
}

/**
 * Accessibility utilities for animations
 */
export function useAnimationAccessibility() {
  const prefersReducedMotion = useCallback(() => {
    if (typeof globalThis.window === "undefined") return false;
    return globalThis.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const getAdaptiveDuration = useCallback((baseDuration: number) => {
    return prefersReducedMotion() ? Math.min(baseDuration * 0.1, 0.1) : baseDuration;
  }, [prefersReducedMotion]);

  const getAdaptiveEasing = useCallback((baseEasing: string) => {
    return prefersReducedMotion() ? "linear" : baseEasing;
  }, [prefersReducedMotion]);

  const shouldAnimate = useCallback(() => {
    return !prefersReducedMotion();
  }, [prefersReducedMotion]);

  return {
    prefersReducedMotion,
    getAdaptiveDuration,
    getAdaptiveEasing,
    shouldAnimate,
  };
}

/**
 * Memory management utilities for animations
 */
export function useAnimationMemory() {
  const animationFramesRef = useRef<Set<number>>(new Set());
  const timeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const intervalsRef = useRef<Set<NodeJS.Timeout>>(new Set());

  const addAnimationFrame = useCallback((frameId: number) => {
    animationFramesRef.current.add(frameId);
  }, []);

  const removeAnimationFrame = useCallback((frameId: number) => {
    animationFramesRef.current.delete(frameId);
  }, []);

  const addTimeout = useCallback((timeoutId: NodeJS.Timeout) => {
    timeoutsRef.current.add(timeoutId);
  }, []);

  const removeTimeout = useCallback((timeoutId: NodeJS.Timeout) => {
    timeoutsRef.current.delete(timeoutId);
  }, []);

  const addInterval = useCallback((intervalId: NodeJS.Timeout) => {
    intervalsRef.current.add(intervalId);
  }, []);

  const removeInterval = useCallback((intervalId: NodeJS.Timeout) => {
    intervalsRef.current.delete(intervalId);
  }, []);

  const cleanup = useCallback(() => {
    // Cancel all animation frames
    animationFramesRef.current.forEach(frameId => {
      cancelAnimationFrame(frameId);
    });
    animationFramesRef.current.clear();

    // Clear all timeouts
    timeoutsRef.current.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    timeoutsRef.current.clear();

    // Clear all intervals
    intervalsRef.current.forEach(intervalId => {
      clearInterval(intervalId);
    });
    intervalsRef.current.clear();
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    addAnimationFrame,
    removeAnimationFrame,
    addTimeout,
    removeTimeout,
    addInterval,
    removeInterval,
    cleanup,
  };
}

/**
 * Animation optimization utilities
 */
export function useAnimationOptimization() {
  const rafQueueRef = useRef<Array<() => void>>([]);
  const isProcessingQueueRef = useRef(false);

  const queueAnimation = useCallback((callback: () => void) => {
    rafQueueRef.current.push(callback);
    
    if (!isProcessingQueueRef.current) {
      isProcessingQueueRef.current = true;
      
      requestAnimationFrame(() => {
        const callbacks = [...rafQueueRef.current];
        rafQueueRef.current = [];
        
        callbacks.forEach(cb => {
          try {
            cb();
          } catch (error) {
            console.error("Animation callback error:", error);
          }
        });
        
        isProcessingQueueRef.current = false;
      });
    }
  }, []);

  const throttleAnimation = useCallback((callback: () => void, delay: number) => {
    let lastCall = 0;
    
    return () => {
      const now = performance.now();
      
      if (now - lastCall >= delay) {
        lastCall = now;
        callback();
      }
    };
  }, []);

  const debounceAnimation = useCallback((callback: () => void, delay: number) => {
    let timeoutId: NodeJS.Timeout;
    
    return () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(callback, delay);
    };
  }, []);

  return {
    queueAnimation,
    throttleAnimation,
    debounceAnimation,
  };
}

/**
 * Performance monitoring for animation frames
 */
export function useFramePerformance() {
  const frameMetricsRef = useRef<{
    count: number;
    totalTime: number;
    maxFrameTime: number;
    minFrameTime: number;
  }>({
    count: 0,
    totalTime: 0,
    maxFrameTime: 0,
    minFrameTime: Infinity,
  });

  const trackFrame = useCallback((frameTime: number) => {
    frameMetricsRef.current.count++;
    frameMetricsRef.current.totalTime += frameTime;
    frameMetricsRef.current.maxFrameTime = Math.max(frameMetricsRef.current.maxFrameTime, frameTime);
    frameMetricsRef.current.minFrameTime = Math.min(frameMetricsRef.current.minFrameTime, frameTime);
  }, []);

  const getFrameMetrics = useCallback(() => {
    const { count, totalTime, maxFrameTime, minFrameTime } = frameMetricsRef.current;
    
    if (count === 0) {
      return {
        averageFrameTime: 0,
        fps: 0,
        maxFrameTime: 0,
        minFrameTime: 0,
        totalFrames: 0,
      };
    }
    
    const averageFrameTime = totalTime / count;
    const fps = 1000 / averageFrameTime;
    
    return {
      averageFrameTime,
      fps,
      maxFrameTime,
      minFrameTime: minFrameTime === Infinity ? 0 : minFrameTime,
      totalFrames: count,
    };
  }, []);

  const resetMetrics = useCallback(() => {
    frameMetricsRef.current = {
      count: 0,
      totalTime: 0,
      maxFrameTime: 0,
      minFrameTime: Infinity,
    };
  }, []);

  return {
    trackFrame,
    getFrameMetrics,
    resetMetrics,
  };
}

/**
 * Resource monitoring for animations
 */
export function useAnimationResources() {
  const resourceUsageRef = useRef<{
    memoryUsed: number;
    animationsActive: number;
    lastCheck: number;
  }>({
    memoryUsed: 0,
    animationsActive: 0,
    lastCheck: 0,
  });

  const trackResourceUsage = useCallback(() => {
    if (typeof globalThis.performance !== "undefined" && "memory" in globalThis.performance) {
      const memory = (globalThis.performance as any).memory;
      resourceUsageRef.current.memoryUsed = memory.usedJSHeapSize;
      resourceUsageRef.current.lastCheck = performance.now();
    }
  }, []);

  const incrementActiveAnimations = useCallback(() => {
    resourceUsageRef.current.animationsActive++;
  }, []);

  const decrementActiveAnimations = useCallback(() => {
    resourceUsageRef.current.animationsActive = Math.max(0, resourceUsageRef.current.animationsActive - 1);
  }, []);

  const getResourceMetrics = useCallback(() => {
    return {
      ...resourceUsageRef.current,
      memoryUsedMB: resourceUsageRef.current.memoryUsed / (1024 * 1024),
    };
  }, []);

  return {
    trackResourceUsage,
    incrementActiveAnimations,
    decrementActiveAnimations,
    getResourceMetrics,
  };
}

/**
 * Combined animation performance hook
 */
export function useAnimationSystem() {
  const performance = useAnimationPerformance();
  const accessibility = useAnimationAccessibility();
  const memory = useAnimationMemory();
  const optimization = useAnimationOptimization();
  const framePerformance = useFramePerformance();
  const resources = useAnimationResources();

  const createOptimizedAnimation = useCallback((
    callback: () => void,
    options: {
      duration?: number;
      shouldRespectReducedMotion?: boolean;
      throttleMs?: number;
    } = {}
  ) => {
    const {
      duration = 300,
      shouldRespectReducedMotion = true,
      throttleMs = 16, // ~60fps
    } = options;

    if (shouldRespectReducedMotion && accessibility.prefersReducedMotion()) {
      // Skip animation or use minimal animation
      callback();
      return () => {};
    }

    const adaptiveDuration = accessibility.getAdaptiveDuration(duration);
    const throttledCallback = optimization.throttleAnimation(callback, throttleMs);
    
    performance.startAnimation();
    resources.incrementActiveAnimations();

    const startTime = performance.now();
    let animationId: number;

    const animate = () => {
      const currentTime = performance.now();
      const elapsed = currentTime - startTime;
      
      framePerformance.trackFrame(elapsed);

      if (elapsed < adaptiveDuration) {
        throttledCallback();
        animationId = requestAnimationFrame(animate);
        memory.addAnimationFrame(animationId);
      } else {
        throttledCallback();
        performance.endAnimation();
        resources.decrementActiveAnimations();
      }
    };

    animationId = requestAnimationFrame(animate);
    memory.addAnimationFrame(animationId);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
        memory.removeAnimationFrame(animationId);
        performance.endAnimation();
        resources.decrementActiveAnimations();
      }
    };
  }, [performance, accessibility, memory, optimization, framePerformance, resources]);

  const getSystemMetrics = useCallback(() => {
    return {
      performance: performance.getPerformanceMetrics(),
      frame: framePerformance.getFrameMetrics(),
      resources: resources.getResourceMetrics(),
      accessibility: {
        prefersReducedMotion: accessibility.prefersReducedMotion(),
      },
    };
  }, [performance, framePerformance, resources, accessibility]);

  return {
    performance,
    accessibility,
    memory,
    optimization,
    framePerformance,
    resources,
    createOptimizedAnimation,
    getSystemMetrics,
  };
}
