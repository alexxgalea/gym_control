/** Ecran încă nemigrat în SPA; se înlocuiește cu ecranul real în tichetul lui. */
export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Ecranul urmează să fie mutat în noua interfață.</p>
    </section>
  );
}
