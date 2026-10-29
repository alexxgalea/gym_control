import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError, adminApi } from "@/api/client";
import { ME_KEY, useMe } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Login() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: adminApi.login,
    onSuccess: (account) => queryClient.setQueryData(ME_KEY, account),
  });

  if (me.data) return <Navigate to="/" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };
  const error = login.error instanceof ApiError ? login.error.detail : login.error ? "A apărut o eroare. Încearcă din nou." : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Autentificare Admin</CardTitle>
          <p className="text-sm text-muted-foreground">Gym Control</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Cont</Label>
              <Input id="username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Parolă</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={login.isPending}>Intră</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
