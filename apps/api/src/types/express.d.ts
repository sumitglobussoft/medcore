import "express";

declare module "express" {
  interface Request {
    params: Record<string, string>;
    query: Record<string, string | undefined>;
  }
}
