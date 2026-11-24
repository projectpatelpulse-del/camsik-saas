import { getMasterDatabase } from "./tenantMaster";
import { listAudit } from "./audit";
import { AVAILABLE_TEMPLATES } from "./templates";

/**
 * Overview metrics, computed only from master-database records.
 * Anything not yet tracked (deployments, SSL issuance) is returned as `null`, never as 0,
 * so the UI can say "not tracked yet" instead of showing a fake figure.
 */
export interface OverviewStats {
  clients: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    inactive: number;
    expired: number;
  };
  databases: { provisioned: number; pending: number };
  domains: { connected: number | null; sslActive: number | null };
  templates: { total: number };
  subscriptions: { active: number; monthlyRecurringRevenue: number };
  builds: {
    android: {
      total: number;
      completed: number;
      failed: number;
      queued: number;
    };
    ios: { total: number; completed: number; failed: number; queued: number };
  };
  deployments: { failed: number | null; live: number | null };
  recentActivity: {
    action: string;
    tenantSlug: string | null;
    actorEmail: string;
    createdAt: string;
  }[];
  generatedAt: string;
}

const STATUS_KEYS = [
  "active",
  "trial",
  "suspended",
  "inactive",
  "expired",
] as const;

export async function getOverviewStats(): Promise<OverviewStats> {
  const db = await getMasterDatabase();

  const [
    statusRows,
    provisionedCount,
    subRows,
    domainRows,
    buildRows,
    activity,
  ] = await Promise.all([
    db
      .collection("tenants")
      .aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray(),
    db.collection("tenants").countDocuments({ dbProvisioned: true }),
    db
      .collection("tenants")
      .aggregate<{ _id: null; active: number; mrr: number }>([
        { $match: { "subscription.status": "active" } },
        {
          $group: {
            _id: null,
            active: { $sum: 1 },
            mrr: { $sum: { $ifNull: ["$subscription.priceMonthly", 0] } },
          },
        },
      ])
      .toArray(),
    db
      .collection("domains")
      .aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection("build_jobs")
      .aggregate<{ _id: { platform: string; status: string }; n: number }>([
        {
          $group: {
            _id: { platform: "$platform", status: "$status" },
            n: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    listAudit(15),
  ]);

  const byStatus: Record<string, number> = Object.fromEntries(
    STATUS_KEYS.map((k) => [k, 0]),
  );
  let clientTotal = 0;
  for (const row of statusRows) {
    clientTotal += row.n;
    if (row._id in byStatus) byStatus[row._id] = row.n;
  }

  const domainByStatus: Record<string, number> = {};
  for (const row of domainRows) domainByStatus[row._id] = row.n;
  const connected =
    (domainByStatus.verified ?? 0) + (domainByStatus.active ?? 0);

  const sub = subRows[0] ?? { active: 0, mrr: 0 };

  const platform = (name: "android" | "ios") => {
    const rows = buildRows.filter((r) => r._id.platform === name);
    const count = (s: string) =>
      rows.filter((r) => r._id.status === s).reduce((a, r) => a + r.n, 0);
    const total = rows.reduce((a, r) => a + r.n, 0);
    return {
      total,
      completed: count("completed"),
      failed: count("failed"),
      queued: count("queued"),
    };
  };

  return {
    clients: {
      total: clientTotal,
      active: byStatus.active,
      trial: byStatus.trial,
      suspended: byStatus.suspended,
      inactive: byStatus.inactive,
      expired: byStatus.expired,
    },
    databases: {
      provisioned: provisionedCount,
      pending: clientTotal - provisionedCount,
    },
    // SSL issuance and deployments are not built yet, so they are reported as untracked.
    domains: { connected, sslActive: null },
    templates: { total: AVAILABLE_TEMPLATES.length },
    subscriptions: { active: sub.active, monthlyRecurringRevenue: sub.mrr },
    builds: { android: platform("android"), ios: platform("ios") },
    deployments: { failed: null, live: null },
    recentActivity: activity.map((a: any) => ({
      action: String(a.action),
      tenantSlug: a.tenantSlug ?? null,
      actorEmail: String(a.actorEmail ?? ""),
      createdAt: new Date(a.createdAt).toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}
