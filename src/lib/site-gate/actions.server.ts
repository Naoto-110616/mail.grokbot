import { deleteCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  changePassword,
  clientIp,
  type PasswordChangeResult,
} from "./gate.ts";
import { liveDeps } from "./handle.server.ts";
import type { SitePasswordResult } from "./rpc.ts";

const cookieOptions = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
};

/** Verify the current password, store a scrypt hash, and refresh this browser's cookie. */
export async function changeSitePassword(input: {
  current: string;
  next: string;
}): Promise<SitePasswordResult> {
  const request = getRequest();
  const result: PasswordChangeResult = await changePassword(
    { current: input.current, next: input.next, ip: clientIp(request.headers) },
    liveDeps(),
  );
  if (!result.ok) return result;
  setCookie(SESSION_COOKIE, result.token, { ...cookieOptions, maxAge: SESSION_MAX_AGE });
  return { ok: true };
}

export async function logoutSite(): Promise<{ ok: true }> {
  deleteCookie(SESSION_COOKIE, cookieOptions);
  setCookie(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return { ok: true };
}
