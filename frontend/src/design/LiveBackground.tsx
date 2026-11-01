import { cn } from "@/lib/utils";
import "./live-background.css";

/**
 * Fundalul „viu” al aplicației: o grilă fină de puncte, vizibilă doar sub un reflector moale care se plimbă încet,
 * peste un degradeu care „respiră”. Pur decorativ (ascuns de cititoarele de ecran), doar CSS, oprit la „Reduce motion”.
 *
 * - `app`: stă fix în spatele întregii pagini (ecranele Adminului); culorile urmează tema.
 * - `dark`: pe un fundal închis care nu urmează tema (Ecranul de la ușă, login); stă în interiorul ecranului, sub
 *   conținut, deci părintele are nevoie de `relative` (sau `fixed`) și `overflow-hidden`.
 */
export function LiveBackground({ tone = "app", className }: { tone?: "app" | "dark"; className?: string }) {
  return (
    <div aria-hidden data-testid="live-background" className={cn("live-bg", tone === "dark" && "live-bg--dark", className)}>
      <div className="live-bg__wash" />
      <div className="live-bg__grid" />
    </div>
  );
}
