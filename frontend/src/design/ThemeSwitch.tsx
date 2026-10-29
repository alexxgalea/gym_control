import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemePreference } from "./theme";

const CHOICES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "Sistem", icon: Monitor },
  { value: "light", label: "Luminoasă", icon: Sun },
  { value: "dark", label: "Întunecată", icon: Moon },
];

/** Comutatorul de temă: sistem, luminoasă sau întunecată. Alegerea se ține minte în browser. */
export function ThemeSwitch() {
  const [preference, setPreference] = useTheme();
  return (
    <div role="radiogroup" aria-label="Temă" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
      {CHOICES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            "flex h-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors",
            preference === value && "bg-card text-foreground shadow-card",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
