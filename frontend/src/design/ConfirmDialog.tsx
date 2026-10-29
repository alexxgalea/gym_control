import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "./button";

/**
 * Dialog de confirmare pentru acțiuni care schimbă sau șterg ceva.
 * `destructive` face butonul de confirmare roșu. Cere explicit confirmarea: Escape și Anulează nu execută nimic.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <DialogPrimitive.Content
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl bg-card p-6 shadow-sheet"
        >
          <div className="flex flex-col gap-1.5 text-center">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
            <DialogPrimitive.Close asChild>
              <Button variant="outline">Anulează</Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
