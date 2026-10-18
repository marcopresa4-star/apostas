"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authSecret, makeSessionToken } from "@/lib/session";

export async function signIn(_prevState: { error: string | null }, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Preenche a palavra-passe." };
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { error: "ADMIN_PASSWORD não está definido — acrescenta-o ao .env.local e reinicia o servidor." };
  if (password !== expected) return { error: "Palavra-passe inválida." };
  // Touch the secret so a missing/short AUTH_SECRET fails before setting cookies.
  authSecret();
  const store = await cookies();
  store.set(SESSION_COOKIE, await makeSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // local dev over http://localhost
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  redirect("/");
}
