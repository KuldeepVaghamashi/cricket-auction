"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { attemptAdminLogin } from "@/lib/auth";
import { authSessionCookieOptions } from "@/lib/auth-cookies";

export type LoginFormState = { error: string } | null;

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await attemptAdminLogin(username, password);
  if (!result.ok) {
    return { error: result.error };
  }

  const cookieStore = await cookies();
  cookieStore.set("auth_token", result.token, authSessionCookieOptions(await headers()));

  redirect("/admin");
}
