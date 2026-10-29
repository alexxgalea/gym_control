import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wifi } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, GENERIC_ERROR, adminApi, type HallSettings } from "@/api/client";
import { errorText, isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useToast } from "@/components/toast";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SETTINGS_KEY = ["admin", "settings"] as const;

type FieldName = "hall_subnet" | "opening_time" | "closing_time" | "retention_months";
type Form = Record<FieldName, string>;
type Errors = Partial<Record<FieldName | "form", string>>;

const toForm = (s: HallSettings): Form => ({ ...s, retention_months: String(s.retention_months) });

export function Settings() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: adminApi.settings.get });
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <ScreenHeader title="Setări" description="Programul Sălii, cât păstrăm datele și rețeaua Wi-Fi a Sălii." />
      {settings.isPending && <Skeleton rows={4} />}
      {isShownError(settings.error) && <ErrorAlert>{settings.error.detail}</ErrorAlert>}
      {settings.data && <SettingsForm saved={settings.data} />}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-card">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function FieldError({ name, message }: { name: FieldName; message?: string }) {
  return message ? (
    <p id={`setting-${name}-error`} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function SettingsForm({ saved }: { saved: HallSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(toForm(saved));
  const [errors, setErrors] = useState<Errors>({});
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);
  const [confirmingShorter, setConfirmingShorter] = useState(false);

  const save = useMutation({
    mutationFn: adminApi.settings.save,
    onSuccess: (result) => {
      setErrors({});
      setForm(toForm(result));
      queryClient.setQueryData(SETTINGS_KEY, result);
      toast("Setările au fost salvate.");
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return setErrors({ form: GENERIC_ERROR });
      const next: Errors = {};
      for (const item of error.errors) next[item.field as FieldName] = item.detail;
      setErrors(Object.keys(next).length > 0 ? next : { form: error.detail });
    },
  });

  const suggest = useMutation({
    mutationFn: adminApi.settings.networkSuggestion,
    onSuccess: (suggestion) => {
      if (suggestion.network) {
        // doar completează câmpul; Adminul salvează separat
        setForm((current) => ({ ...current, hall_subnet: suggestion.network! }));
        setErrors((current) => ({ ...current, hall_subnet: undefined }));
        setSuggestionNote(`Rețeaua a fost completată din conexiunea ta (${suggestion.address}). Apasă „Salvează” ca s-o păstrezi.`);
      } else {
        setSuggestionNote(suggestion.message);
      }
    },
    onError: (error) => setSuggestionNote(errorText(error)),
  });

  const months = Number(form.retention_months);
  const shortensRetention = /^\d+$/.test(form.retention_months.trim()) && months >= 1 && months < saved.retention_months;

  const send = () => {
    setConfirmingShorter(false);
    setErrors({});
    save.mutate(form);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (shortensRetention) setConfirmingShorter(true);
    else send();
  };

  const described = (name: FieldName) => ({
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": errors[name] ? `setting-${name}-error` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {errors.form && <ErrorAlert>{errors.form}</ErrorAlert>}

      <Section
        title="Programul Sălii"
        description="Orele între care Sala e deschisă. O Intrare în afara programului apare la „De verificat”, iar o Sesiune rămasă deschisă se închide la ora de închidere."
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setting-opening_time">Ora de deschidere</Label>
            <Input
              id="setting-opening_time"
              type="time"
              value={form.opening_time}
              onChange={(e) => setForm({ ...form, opening_time: e.target.value })}
              {...described("opening_time")}
            />
            <FieldError name="opening_time" message={errors.opening_time} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setting-closing_time">Ora de închidere</Label>
            <Input
              id="setting-closing_time"
              type="time"
              value={form.closing_time}
              onChange={(e) => setForm({ ...form, closing_time: e.target.value })}
              {...described("closing_time")}
            />
            <FieldError name="closing_time" message={errors.closing_time} />
          </div>
        </div>
      </Section>

      <Section
        title="Păstrarea datelor"
        description="Sesiunile și rândurile din Jurnal mai vechi de atât se șterg automat, în afara celor din Incidentele deschise."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setting-retention_months">Păstrează datele</Label>
          <div className="flex items-center gap-2">
            <Input
              id="setting-retention_months"
              inputMode="numeric"
              className="w-24"
              value={form.retention_months}
              onChange={(e) => setForm({ ...form, retention_months: e.target.value })}
              {...described("retention_months")}
            />
            <span className="text-[15px] text-muted-foreground">luni</span>
          </div>
          <FieldError name="retention_months" message={errors.retention_months} />
        </div>
      </Section>

      <Section
        title="Avansat"
        description="Telefoanele Angajaților trebuie să fie conectate la această rețea ca să facă Intrare sau Ieșire. Modific-o doar dacă s-a schimbat Wi-Fi-ul Sălii."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setting-hall_subnet">Rețeaua Wi-Fi a Sălii</Label>
          <Input
            id="setting-hall_subnet"
            value={form.hall_subnet}
            onChange={(e) => setForm({ ...form, hall_subnet: e.target.value })}
            {...described("hall_subnet")}
          />
          <FieldError name="hall_subnet" message={errors.hall_subnet} />
        </div>
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
            <Wifi className="size-4" aria-hidden /> Folosește rețeaua la care sunt conectat acum
          </Button>
          {suggestionNote && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {suggestionNote}
            </p>
          )}
        </div>
      </Section>

      <div>
        <Button type="submit" disabled={save.isPending}>
          Salvează
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingShorter}
        onOpenChange={setConfirmingShorter}
        title="Scurtezi perioada de păstrare?"
        description={`Datele mai vechi de ${months} luni se vor șterge. Nu se poate anula.`}
        confirmLabel="Salvează și șterge datele vechi"
        destructive
        pending={save.isPending}
        onConfirm={send}
      />
    </form>
  );
}
