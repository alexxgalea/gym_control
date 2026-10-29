import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError, GENERIC_ERROR, adminApi } from "@/api/client";
import { ErrorAlert } from "@/components/ErrorAlert";
import { ME_KEY, useMe } from "@/auth";
import { Button } from "@/design/button";
import { Logo } from "@/design/Logo";
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
  const error = login.error instanceof ApiError ? login.error.detail : login.error ? GENERIC_ERROR : null;

  return (
    <main className="bg-gradient-brand flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Logo size={72} wordmark={false} />
      <h1 className="text-3xl font-semibold tracking-tight text-white">GymCtrl</h1>
      <Card className="w-full max-w-sm text-foreground">
        <CardHeader>
          <CardTitle>Intră în contul de Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <ErrorAlert>{error}</ErrorAlert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Nume de utilizator</Label>
              <Input id="username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Parolă</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={login.isPending}>Intră în cont</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
