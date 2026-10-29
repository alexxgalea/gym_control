import { ApiError, GENERIC_ERROR } from "@/api/client";

/** Mesajul unei erori: cel al serverului pentru `ApiError`, altfel cel generic. */
export const errorText = (error: unknown) => (error instanceof ApiError ? error.detail : GENERIC_ERROR);

/** Eroare de interogare de arătat în ecran; 401 e tratat de login, nu se afișează. */
export const isShownError = (error: unknown): error is ApiError => error instanceof ApiError && error.status !== 401;
