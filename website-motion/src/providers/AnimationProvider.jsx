import { LazyMotion, domAnimation, MotionConfig } from "framer-motion";
import { prefersReducedMotion } from "../lib/motion.js";

/**
 * Path B foundation — LazyMotion + reduced-motion aware config.
 * Keep features light for mid-range Android in Kenya.
 */
export default function AnimationProvider({ children }) {
  const reduced = prefersReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>
    </LazyMotion>
  );
}
