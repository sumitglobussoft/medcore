import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// We don't want these tests to touch Postgres. Mock `@medcore/db` with an
// in-memory implementation that mirrors the slice of the Prisma API the
// registry uses: findFirst, findUnique, aggregate, create, update,
// updateMany, count, findMany, $transaction.

const { db, prismaMock } = vi.hoisted(() => {
  type Row = {
    id: string;
    key: string;
    version: number;
    content: string;
    createdBy: string;
    createdAt: Date;
    active: boolean;
    notes: string | null;
  };
  const rows: Row[] = [];
  let idSeq = 0;

  function matchWhere(r: Row, where: any): boolean {
    if (!where) return true;
    if (where.key !== undefined && r.key !== where.key) return false;
    if (where.active !== undefined && r.active !== where.active) return false;
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.NOT?.id !== undefined && r.id === where.NOT.id) return false;
    if (where.version && typeof where.version === "object") {
      if (where.version.lt !== undefined && !(r.version < where.version.lt)) return false;
    }
    return true;
  }

  const prismaMock = {
    prompt: {
      findFirst: vi.fn(async (args: any) => {
        let matches = rows.filter((r) => matchWhere(r, args?.where));
        if (args?.orderBy?.version === "desc") {
          matches = [...matches].sort((a, b) => b.version - a.version);
        }
        return matches[0] ?? null;
      }),
      findUnique: vi.fn(async (args: any) => {
        if (args.where.id) return rows.find((r) => r.id === args.where.id) ?? null;
        if (args.where.key_version) {
          const { key, version } = args.where.key_version;
          return rows.find((r) => r.key === key && r.version === version) ?? null;
        }
        return null;
      }),
      findMany: vi.fn(async (args: any) => {
        let matches = rows.filter((r) => matchWhere(r, args?.where));
        if (args?.orderBy?.version === "desc") {
          matches = [...matches].sort((a, b) => b.version - a.version);
        }
        const skip = args?.skip ?? 0;
        const take = args?.take ?? matches.length;
        return matches.slice(skip, skip + take);
      }),
      count: vi.fn(async (args: any) =>
        rows.filter((r) => matchWhere(r, args?.where)).length
      ),
      aggregate: vi.fn(async (args: any) => {
        const matches = rows.filter((r) => matchWhere(r, args?.where));
        const max =
          matches.length === 0
            ? null
            : Math.max(...matches.map((r) => r.version));
        return { _max: { version: max } };
      }),
      create: vi.fn(async (args: any) => {
        const r: Row = {
          id: `id-${++idSeq}`,
          key: args.data.key,
          version: args.data.version,
          content: args.data.content,
          createdBy: args.data.createdBy,
          createdAt: new Date(),
          active: args.data.active ?? false,
          notes: args.data.notes ?? null,
        };
        rows.push(r);
        return r;
      }),
      update: vi.fn(async (args: any) => {
        const r = rows.find((x) => x.id === args.where.id);
        if (!r) throw new Error("not found");
        Object.assign(r, args.data);
        return r;
      }),
      updateMany: vi.fn(async (args: any) => {
        let n = 0;
        for (const r of rows) {
          if (matchWhere(r, args.where)) {
            Object.assign(r, args.data);
            n++;
          }
        }
        return { count: n };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
  };

  return {
    db: {
      reset: () => {
        rows.length = 0;
        idSeq = 0;
      },
      rows,
    },
    prismaMock,
  };
});

vi.mock("@medcore/db", () => ({
  prisma: prismaMock,
}));

import {
  getActivePrompt,
  createPromptVersion,
  activatePromptVersion,
  rollbackPromptKey,
  listPromptVersions,
  clearPromptCache,
} from "./prompt-registry";
import { PROMPTS } from "./prompts";

beforeEach(() => {
  db.reset();
  clearPromptCache();
  // Reset only the mock call history; preserve mock implementations so the
  // in-memory prompt store keeps working across tests.
  for (const fn of Object.values(prismaMock.prompt)) {
    (fn as any).mockClear?.();
  }
  (prismaMock.$transaction as any).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getActivePrompt ───────────────────────────────────────────────────────────

describe("getActivePrompt", () => {
  it("falls back to the static PROMPTS constant when the DB has no row", async () => {
    const out = await getActivePrompt("TRIAGE_SYSTEM");
    expect(out).toBe(PROMPTS.TRIAGE_SYSTEM);
  });

  it("returns the active DB row's content when one exists", async () => {
    await createPromptVersion("TRIAGE_SYSTEM", "db version content", "user-1");
    const created = db.rows[0];
    await activatePromptVersion(created.id);

    const out = await getActivePrompt("TRIAGE_SYSTEM");
    expect(out).toBe("db version content");
  });

  it("falls back to PROMPTS when the DB throws on read (never crashes LLM call)", async () => {
    // Force findFirst to throw — mimics a transient Postgres outage.
    (prismaMock.prompt.findFirst as any).mockImplementationOnce(async () => {
      throw new Error("connection reset");
    });
    const out = await getActivePrompt("SCRIBE_SYSTEM");
    expect(out).toBe(PROMPTS.SCRIBE_SYSTEM);
  });

  it("caches the result for 60s so we don't re-query on every LLM call", async () => {
    await createPromptVersion("TRIAGE_SYSTEM", "cached-content", "u");
    await activatePromptVersion(db.rows[0].id);
    // Note: activatePromptVersion clears the cache. Prime the cache now.
    await getActivePrompt("TRIAGE_SYSTEM");

    const callsBefore = (prismaMock.prompt.findFirst as any).mock.calls.length;
    for (let i = 0; i < 5; i++) {
      await getActivePrompt("TRIAGE_SYSTEM");
    }
    const callsAfter = (prismaMock.prompt.findFirst as any).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });
});

// ── createPromptVersion ───────────────────────────────────────────────────────

describe("createPromptVersion", () => {
  it("auto-increments the version per key starting at 1", async () => {
    const v1 = await createPromptVersion("K1", "content v1", "user-a");
    const v2 = await createPromptVersion("K1", "content v2", "user-a");
    const v1_other = await createPromptVersion("K2", "other v1", "user-a");
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    // Different key restarts the sequence.
    expect(v1_other.version).toBe(1);
    expect(v1.active).toBe(false);
  });

  it("rejects empty content", async () => {
    await expect(
      createPromptVersion("K", "", "u")
    ).rejects.toThrow(/non-empty/i);
  });
});

// ── activatePromptVersion + rollback ──────────────────────────────────────────

describe("activatePromptVersion", () => {
  it("flips active flag and deactivates the previously-active version", async () => {
    await createPromptVersion("TRIAGE_SYSTEM", "v1", "u");
    const v1Id = db.rows[0].id;
    await activatePromptVersion(v1Id);

    await createPromptVersion("TRIAGE_SYSTEM", "v2", "u");
    const v2Id = db.rows[1].id;
    await activatePromptVersion(v2Id);

    const v1 = db.rows.find((r) => r.id === v1Id)!;
    const v2 = db.rows.find((r) => r.id === v2Id)!;
    expect(v1.active).toBe(false);
    expect(v2.active).toBe(true);

    // Fresh read reflects the change (cache was cleared).
    const current = await getActivePrompt("TRIAGE_SYSTEM");
    expect(current).toBe("v2");
  });

  it("throws for an unknown id", async () => {
    await expect(activatePromptVersion("does-not-exist")).rejects.toThrow(
      /not found/i
    );
  });
});

describe("rollbackPromptKey", () => {
  it("activates the previous version and deactivates the current one", async () => {
    await createPromptVersion("SCRIBE_SYSTEM", "v1", "u");
    await activatePromptVersion(db.rows[0].id);
    await createPromptVersion("SCRIBE_SYSTEM", "v2", "u");
    await activatePromptVersion(db.rows[1].id);

    const rolled = await rollbackPromptKey("SCRIBE_SYSTEM");
    expect(rolled.version).toBe(1);
    expect(rolled.active).toBe(true);
    const v2 = db.rows.find((r) => r.version === 2)!;
    expect(v2.active).toBe(false);

    // And reading confirms it.
    const current = await getActivePrompt("SCRIBE_SYSTEM");
    expect(current).toBe("v1");
  });

  it("errors when there is no prior version to roll back to", async () => {
    await createPromptVersion("LONE_KEY", "only-version", "u");
    await activatePromptVersion(db.rows[0].id);
    await expect(rollbackPromptKey("LONE_KEY")).rejects.toThrow(
      /no prior version/i
    );
  });

  it("errors when there is no active version at all for the key", async () => {
    await expect(rollbackPromptKey("NEVER_ACTIVATED")).rejects.toThrow(
      /no active version/i
    );
  });
});

// ── listPromptVersions ────────────────────────────────────────────────────────

describe("listPromptVersions", () => {
  it("returns versions newest-first, paginated", async () => {
    for (let i = 1; i <= 5; i++) {
      await createPromptVersion("MULTI", `v${i}`, "u");
    }
    const page1 = await listPromptVersions("MULTI", { page: 1, pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items.map((x) => x.version)).toEqual([5, 4]);

    const page2 = await listPromptVersions("MULTI", { page: 2, pageSize: 2 });
    expect(page2.items.map((x) => x.version)).toEqual([3, 2]);

    const page3 = await listPromptVersions("MULTI", { page: 3, pageSize: 2 });
    expect(page3.items.map((x) => x.version)).toEqual([1]);
  });
});
