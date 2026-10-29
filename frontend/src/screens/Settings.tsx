import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, GENERIC_ERROR, adminApi, type HallSettings } from "@/api/client";
import { isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SETTINGS_KEY = ["admin", "settings"] as const;

type FieldName = "hall_subnet" | "opening_time" | "closing_time" | "retention_months";
type Form = Record<FieldName, string>;
type Errors = Partial<Record<FieldName | "form", string>>;

const FIELDS: { name: FieldName; label: string; placeholder?: string; inputMode: "text" | "numeric" }[] = [
  { name: "hall_subnet", label: "Subrețeaua Sălii (CIDR)", inputMode: "text" },
  { name: "opening_time", label: "Ora de deschidere (program, HH:MM)", placeholder: "06:00", inputMode: "numeric" },
  { name: "closing_time", label: "Ora de închidere (HH:MM)", placeholder: "22:00", inputMode: "numeric" },
  { name: "retention_months", label: "Perioada de retenție (luni)", inputMode: "numeric" },
];

const toForm = (s: HallSettings): Form => ({ ...s, retention_months: String(s.retention_months) });

export function Settings() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: adminApi.settings.get });
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Setări</h1>
      {settings.isPending && <p className="text-muted-foreground">Se încarcă…</p>}
      {isShownError(settings.error) && (
        <ErrorAlert>
          {settings.error.detail}
        </ErrorAlert>
      )}
      {settings.data && <SettingsForm initial={toForm(settings.data)} />}
    </div>
  );
}

function SettingsForm({ initial }: { initial: Form }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: adminApi.settings.save,
    onSuccess: (saved) => {
      setErrors({});
      setForm(toForm(saved));
      queryClient.setQueryData(SETTINGS_KEY, saved);
      toast("Setările au fost salvate.");
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return setErrors({ form: GENERIC_ERROR });
      const next: Errors = {};
      for (const item of error.errors) next[item.field as FieldName] = item.detail;
      setErrors(Object.keys(next).length > 0 ? next : { form: error.detail });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    save.mutate(form);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      {errors.form && (
        <ErrorAlert>
          {errors.form}
        </ErrorAlert>
      )}
      {FIELDS.map(({ name, label, placeholder, inputMode }) => (
        <div key={name} className="flex flex-col gap-2">
          <Label htmlFor={`setting-${name}`}>{label}</Label>
          <Input
            id={`setting-${name}`}
            value={form[name]}
            placeholder={placeholder}
            inputMode={inputMode}
            onChange={(e) => setForm({ ...form, [name]: e.target.value })}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? `setting-${name}-error` : undefined}
          />
          {errors[name] && (
            <p id={`setting-${name}-error`} className="text-sm text-destructive">
              {errors[name]}
            </p>
          )}
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        Sesiunile și rândurile din Jurnal mai vechi de atât se șterg automat, în afara celor din Incidentele deschise.
      </p>
      <div>
        <Button type="submit" disabled={save.isPending}>
          Salvează
        </Button>
      </div>
    </form>
  );
}
