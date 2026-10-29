import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { ME_KEY } from "@/auth";

/** Orice cerere care primește 401 înseamnă sesiune expirată: contul curent devine `null` și aplicația duce la login. */
export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) client.setQueryData(ME_KEY, null);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) client.setQueryData(ME_KEY, null);
      },
    }),
    defaultOptions: { queries: { retry: false } },
  });
  return client;
}
