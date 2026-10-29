import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Foaia pentru formulare: glisează de jos pe telefon, apare centrată pe desktop.
 * E un dialog modal (focus prins în ea, Escape o închide).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/45"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              {/* învelișul acoperă ecranul; un clic pe el, în afara foii, o închide */}
              <div
                className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
                onClick={(event) => {
                  if (event.target === event.currentTarget) onOpenChange(false);
                }}
              >
                <motion.div
                  className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-background pb-8 shadow-sheet sm:max-w-lg sm:rounded-3xl sm:pb-6"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                >
                  <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-muted-foreground/40 sm:hidden" aria-hidden />
                  <div className="flex items-center justify-between px-4 pt-3">
                    <DialogPrimitive.Close className="cursor-pointer py-2 text-base text-primary">
                      Anulează
                    </DialogPrimitive.Close>
                  </div>
                  <div className="px-6 pt-1 text-center">
                    <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  </div>
                  <div className="flex flex-col gap-4 px-4 pt-5">{children}</div>
                </motion.div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
