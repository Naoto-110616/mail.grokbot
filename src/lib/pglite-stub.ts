/** Build-time stub so Cloudflare Worker bundles never ship @electric-sql/pglite. */
export class PGlite {
  constructor(_options?: unknown) {
    throw new Error("PGLite is not available on Cloudflare Workers");
  }
  waitReady = Promise.reject(new Error("PGLite is not available on Cloudflare Workers"));
  query = async (): Promise<never> => {
    throw new Error("PGLite is not available on Cloudflare Workers");
  };
  exec = async (): Promise<never> => {
    throw new Error("PGLite is not available on Cloudflare Workers");
  };
  transaction = async (): Promise<never> => {
    throw new Error("PGLite is not available on Cloudflare Workers");
  };
}
