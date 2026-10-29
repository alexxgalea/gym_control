import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";

/** Stare goală prietenoasă: o iconiță mare și o propoziție (de exemplu „Nicio Anomalie de verificat”). */
export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="flex flex-col items-center gap-3 px-6 py-10 text-center"
    >
      <span className="flex size-20 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-10" strokeWidth={1.75} aria-hidden />
      </span>
      <p className="max-w-xs text-[15px] text-muted-foreground">{text}</p>
    </motion.div>
  );
}
