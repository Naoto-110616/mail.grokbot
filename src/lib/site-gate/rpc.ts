import { createServerFn } from "@tanstack/react-start";

export type SitePasswordResult = { ok: true } | { ok: false; error: string };

function passwordFields(input: unknown): { current: string; next: string } {
  if (!input || typeof input !== "object") return { current: "", next: "" };
  const row = input as { current?: unknown; next?: unknown };
  return {
    current: typeof row.current === "string" ? row.current : "",
    next: typeof row.next === "string" ? row.next : "",
  };
}

export const changeSitePassword = createServerFn({ method: "POST" })
  .validator(passwordFields)
  .handler(async ({ data }) => {
    const { changeSitePassword: run } = await import("./actions.server.ts");
    return run(data);
  });

export const logoutSite = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: true }> => {
  const { logoutSite: run } = await import("./actions.server.ts");
  return run();
});

/** False when this deploy has no database, so the password cannot be changed here. */
export const sitePasswordEditable = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ enabled: boolean }> => {
    const { passwordChangesEnabled } = await import("./store.server.ts");
    return { enabled: passwordChangesEnabled() };
  },
);
