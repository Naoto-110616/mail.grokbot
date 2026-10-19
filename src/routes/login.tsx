import { createFileRoute } from "@tanstack/react-router";
import { loginErrorMessage } from "@/lib/site-gate/messages";
import { LOGIN_NEXT_FIELD, LOGIN_PASSWORD_FIELD, safeNextPath } from "@/lib/site-gate/paths";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    e: typeof search.e === "string" ? search.e : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { e, next } = Route.useSearch();
  const error = loginErrorMessage(e);
  const back = safeNextPath(next);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-6 text-ink">
      <div className="w-full max-w-[400px] py-10">
        <h1 className="text-[31px] font-bold leading-9">Grokbot Mail</h1>
        <p className="mt-2 text-[15px] leading-5 text-muted">Enter the password for this site.</p>
        <form className="mt-6" method="post" action="/login">
          {back ? <input type="hidden" name={LOGIN_NEXT_FIELD} value={back} /> : null}
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold text-muted">Password</span>
            <input
              name={LOGIN_PASSWORD_FIELD}
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              className="h-12 w-full rounded-xl border border-line bg-paper px-3 text-[15px] text-ink outline-none focus:border-accent"
            />
          </label>
          {error ? (
            <p role="alert" className="mt-3 text-[15px] leading-5 text-danger">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-4 h-11 w-full rounded-full bg-ink text-[15px] font-bold text-paper"
          >
            Log in
          </button>
        </form>
      </div>
    </main>
  );
}
