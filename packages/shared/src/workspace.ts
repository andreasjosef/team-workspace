import { z } from 'zod';

// The product context around the code: decisions and docs from the product
// repo, and incidents from support. What the PO and CS views are built on,
// and what the agent's context builder draws from.

export const DocKind = z.enum(['decision', 'doc']);
export type DocKind = z.infer<typeof DocKind>;

export const ProductDoc = z.object({
  // Repo-relative path, e.g. decisions/D-014-discount-codes.md
  path: z.string(),
  kind: DocKind,
  id: z.string(), // D-014 for decisions, the path for docs
  title: z.string(),
  date: z.string().nullable(),
  by: z.string().nullable(),
  // Code the document explains (decisions only).
  files: z.array(z.string()),
  body: z.string(),
});
export type ProductDoc = z.infer<typeof ProductDoc>;

export const Severity = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof Severity>;

// A customer report. In the demo these come from a JSON file; in a product,
// from the support tool. The body is customer-written and untrusted.
export const Incident = z.object({
  id: z.string(),
  at: z.string(),
  customer: z.string(),
  channel: z.enum(['email', 'chat', 'form']),
  severity: Severity,
  subject: z.string(),
  body: z.string(),
});
export type Incident = z.infer<typeof Incident>;
