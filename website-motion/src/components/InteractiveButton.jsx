import { m } from "framer-motion";

/** Reference Path B CTA — spring tap feedback, GPU transforms only. */
export function InteractiveButton({ label, onClick, className = "", type = "button", href }) {
  const Comp = href ? m.a : m.button;
  const props = href
    ? { href, target: href.startsWith("http") ? "_blank" : undefined, rel: href.startsWith("http") ? "noopener" : undefined }
    : { type };

  return (
    <Comp
      {...props}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      onClick={onClick}
      className={className}
      style={{ minHeight: 48, displayOrigin: "center" }}
    >
      {label}
    </Comp>
  );
}
