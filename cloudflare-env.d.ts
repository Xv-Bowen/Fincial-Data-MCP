declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    FINANCE_OWNER_EMAIL?: string;
    SITE_ORIGIN?: string;
    FINANCE_BACKEND_URL?: string;
    FINANCE_BACKEND_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
