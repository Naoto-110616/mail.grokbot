import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Supplying requestMiddleware replaces the default CSRF middleware, so keep it.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const siteGate = createMiddleware({ type: "request" }).server(async ({ next, request, pathname, handlerType }) => {
  const { handleSiteRequest } = await import("./lib/site-gate/handle.server.ts");
  const blocked = await handleSiteRequest({ request, pathname, handlerType });
  if (blocked) return blocked;
  return next();
});

const siteGateFns = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { assertSiteSession } = await import("./lib/site-gate/handle.server.ts");
  await assertSiteSession();
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, siteGate],
  functionMiddleware: [siteGateFns],
}));
