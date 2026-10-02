/* ==========================================================================
   Cost ledger and local budget.

   From specs/BYOK.md:
     - estimated / reported / reconciled / unknown are distinct states
     - unknown is never 0; a failed or cancelled call can still be billed
     - usage units and money are not interchangeable and must not be summed
       across units or currencies
     - the budget limits *this app's* new submissions only. It has no authority
       over the provider's account, other clients, or the provider's own
       billing. Saying otherwise would be a false promise.

   Reservations are taken inside a SQLite transaction so two concurrent
   submissions cannot both pass a limit check.
   ========================================================================== */

import { randomUUID } from "node:crypto";
import { getSetting, setSetting } from "./db.mjs";

const DEFAULT_BUDGET = { limit: null, currency: "USD" };

export class CostLedger {
  #db;
  #now;

  constructor({ db, now = () => new Date().toISOString() }) {
    this.#db = db;
    this.#now = now;
  }

  /* -------------------------------------------------------- recording -- */

  /**
   * Record a cost for a job. `unknown` stores no amount, so a later summary
   * cannot accidentally treat "we don't know" as free.
   */
  record({ jobId, providerId, state, amount, unit, currency, source, asOf }) {
    if (!["estimated", "reported", "reconciled", "unknown"].includes(state)) {
      throw new TypeError(`unknown cost state: ${state}`);
    }
    const unknown = state === "unknown";
    if (!unknown && typeof amount !== "number") {
      throw new TypeError(`a ${state} cost needs a numeric amount`);
    }
    if (unknown && typeof amount === "number") {
      throw new TypeError("an unknown cost must not carry a numeric amount");
    }

    this.#db
      .prepare(
        `INSERT INTO usage_entries
           (id, job_id, provider_id, state, amount, unit, currency, source, as_of, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(job_id, state) DO UPDATE SET
           amount = excluded.amount, unit = excluded.unit,
           currency = excluded.currency, source = excluded.source, as_of = excluded.as_of`,
      )
      .run(
        randomUUID(),
        jobId,
        providerId,
        state,
        unknown ? null : amount,
        unknown ? null : (unit ?? null),
        unknown ? null : (currency ?? null),
        unknown ? "unverified" : (source ?? null),
        unknown ? null : (asOf ?? null),
        this.#now(),
      );

    return this.forJob(jobId);
  }

  forJob(jobId) {
    return this.#db
      .prepare("SELECT * FROM usage_entries WHERE job_id = ? ORDER BY created_at")
      .all(jobId)
      .map((r) => ({
        state: r.state,
        amount: r.amount,
        unit: r.unit,
        currency: r.currency,
        source: r.source,
        asOf: r.as_of,
      }));
  }

  /* --------------------------------------------------------- summary -- */

  /**
   * Totals, kept honest about what is missing. Money and character/credit
   * units are reported in separate buckets rather than added together.
   */
  summary() {
    const rows = this.#db.prepare("SELECT * FROM usage_entries").all();

    const money = new Map();
    const units = new Map();
    let unknownCount = 0;

    for (const r of rows) {
      if (r.state === "unknown" || r.amount === null) {
        unknownCount += 1;
        continue;
      }
      if (r.currency) {
        const k = r.currency;
        const cur = money.get(k) ?? { currency: k, total: 0, entries: 0 };
        cur.total = round(cur.total + r.amount);
        cur.entries += 1;
        money.set(k, cur);
      } else {
        const k = r.unit ?? "unknown-unit";
        const cur = units.get(k) ?? { unit: k, total: 0, entries: 0 };
        cur.total += r.amount;
        cur.entries += 1;
        units.set(k, cur);
      }
    }

    return {
      money: [...money.values()],
      usage: [...units.values()],
      unknown: {
        count: unknownCount,
        // The number that matters: we could not price these.
        note: unknownCount
          ? "存在未定价记录，实际花费未知，不计入任何合计"
          : null,
      },
    };
  }

  /* ---------------------------------------------------------- budget -- */

  budget() {
    return getSetting(this.#db, "budget", DEFAULT_BUDGET);
  }

  setBudget({ limit, currency = "USD" }) {
    if (limit !== null && (typeof limit !== "number" || limit < 0)) {
      throw new TypeError("budget limit must be a non-negative number or null");
    }
    setSetting(this.#db, "budget", { limit, currency });
    return this.budget();
  }

  /** Money already committed by entries that are not unknown. */
  committed(currency) {
    const row = this.#db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS total FROM usage_entries " +
          "WHERE currency = ? AND state != 'unknown' AND amount IS NOT NULL",
      )
      .get(currency);
    return row?.total ?? 0;
  }

  countUnknown() {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS n FROM usage_entries WHERE state = 'unknown'")
      .get();
    return row?.n ?? 0;
  }

  /**
   * Decide whether a new submission is allowed, atomically.
   *
   * An estimated cost is checked against the limit. An unknown cost cannot be
   * bounded, so it is allowed only with `acknowledgeUnknown`, which the UI
   * must set deliberately — that is the "逐次确认" path in specs/BYOK.md.
   *
   * Returns a decision; it does not itself submit anything.
   */
  checkBudget({ estimatedAmount, currency, acknowledgeUnknown = false }) {
    const budget = this.budget();
    if (budget.limit === null) {
      return { allowed: true, reason: null, requiresConfirmation: false };
    }

    const unknown = typeof estimatedAmount !== "number";

    if (unknown) {
      if (!acknowledgeUnknown) {
        return {
          allowed: false,
          requiresConfirmation: true,
          reason: "该请求没有可核实的预估价格，需你逐次确认后才会提交",
        };
      }
      return {
        allowed: true,
        requiresConfirmation: false,
        reason: "已确认未知价格提交；本次花费无法预估",
      };
    }

    if ((estimatedAmount ?? 0) > 0 && currency !== budget.currency) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `预算以 ${budget.currency} 计价，无法与 ${currency} 直接比较`,
      };
    }

    const spent = this.committed(budget.currency);
    if (spent + estimatedAmount > budget.limit) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `将超出本地预算（已用 ${spent}${budget.currency}，本次预估 ${estimatedAmount}）`,
      };
    }

    return { allowed: true, requiresConfirmation: false, reason: null };
  }

  /**
   * What this budget does and does not control. Surfaced verbatim in the UI so
   * the local limit is not mistaken for a provider-side guarantee.
   */
  budgetScope() {
    return {
      controls: "本应用发起的新任务提交",
      doesNotControl: [
        "供应商账户在其他客户端的花费",
        "供应商自身的计费与限额",
        "任何已提交任务的实际扣费",
      ],
    };
  }
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
