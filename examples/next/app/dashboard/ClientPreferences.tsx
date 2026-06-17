"use client";

import { cookies } from "next/headers";

export function ClientPreferences() {
  return <button>{cookies().get("theme")?.value ?? "system"}</button>;
}
