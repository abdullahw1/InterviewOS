/**
 * /costs — Cost tracking dashboard
 *
 * Shows Vapi spend, OpenAI spend, and combined spend grouped by feature
 * for the last 7 days, last 30 days, and current month.
 *
 * Validates: Requirements 12.1, 12.6, 20.8
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type WindowStats = {
  vapiTotal: number;
  openaiTotal: number;
  combined: number;
  byFeature: Record<string, { vapi: number; openai: number; total: number }>;
  vapiMinutesTotal: number;
};

async function getWindowStats(since: Date): Promise<WindowStats> {
  const records = await prisma.costRecord.findMany({
    where: { createdAt: { gte: since } },
    select: { feature: true, model: true, estimatedCost: true, vapiMinutes: true },
  });

  let vapiTotal = 0;
  let openaiTotal = 0;
  let vapiMinutesTotal = 0;
  const byFeature: Record<string, { vapi: number; openai: number; total: number }> = {};

  for (const r of records) {
    const isVapi = r.model === 'vapi';
    const cost = r.estimatedCost;
    const featureKey = r.feature.replace(/^(text|voice)-drill:[a-z0-9]+/, '$1-drill');

    if (!byFeature[featureKey]) byFeature[featureKey] = { vapi: 0, openai: 0, total: 0 };

    if (isVapi) {
      vapiTotal += cost;
      byFeature[featureKey].vapi += cost;
      if (r.vapiMinutes) vapiMinutesTotal += r.vapiMinutes;
    } else {
      openaiTotal += cost;
      byFeature[featureKey].openai += cost;
    }
    byFeature[featureKey].total += cost;
  }

  return {
    vapiTotal,
    openaiTotal,
    combined: vapiTotal + openaiTotal,
    byFeature,
    vapiMinutesTotal,
  };
}

async function getAllStats() {
  const now = new Date();

  const last7 = new Date(now);
  last7.setDate(now.getDate() - 7);

  const last30 = new Date(now);
  last30.setDate(now.getDate() - 30);

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [w7, w30, wMonth, recentRecords] = await Promise.all([
    getWindowStats(last7),
    getWindowStats(last30),
    getWindowStats(currentMonthStart),
    prisma.costRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        feature: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCost: true,
        vapiCallId: true,
        callDurationSeconds: true,
        vapiMinutes: true,
        createdAt: true,
      },
    }),
  ]);

  return { w7, w30, wMonth, recentRecords };
}

function fmt(n: number) {
  return `$${n.toFixed(4)}`;
}

function WindowCard({
  label,
  stats,
}: {
  label: string;
  stats: WindowStats;
}) {
  const features = Object.entries(stats.byFeature).sort(
    ([, a], [, b]) => b.total - a.total,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription className="text-xl font-bold text-foreground">
          {fmt(stats.combined)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-muted/50 rounded p-2">
            <p className="text-xs text-muted-foreground">Vapi</p>
            <p className="font-semibold">{fmt(stats.vapiTotal)}</p>
            {stats.vapiMinutesTotal > 0 && (
              <p className="text-xs text-muted-foreground">
                {stats.vapiMinutesTotal.toFixed(1)} min
              </p>
            )}
          </div>
          <div className="bg-muted/50 rounded p-2">
            <p className="text-xs text-muted-foreground">OpenAI</p>
            <p className="font-semibold">{fmt(stats.openaiTotal)}</p>
          </div>
        </div>

        {features.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">By Feature</p>
            <div className="space-y-1">
              {features.map(([feature, costs]) => (
                <div key={feature} className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[120px]">{feature}</span>
                  <span className="font-mono font-medium">{fmt(costs.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function CostsPage() {
  const { w7, w30, wMonth, recentRecords } = await getAllStats();

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold">Cost Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API spend across Vapi voice calls and OpenAI completions
        </p>
      </div>

      {/* Time-windowed summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <WindowCard label="Last 7 Days" stats={w7} />
        <WindowCard label="Last 30 Days" stats={w30} />
        <WindowCard label="Current Month" stats={wMonth} />
      </div>

      {/* Recent records table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent API Calls</CardTitle>
          <CardDescription>Last 15 tracked calls</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Feature</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Details</th>
                  <th className="py-2 text-right">Cost</th>
                  <th className="py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentRecords.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="truncate block max-w-[180px]">{r.feature}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        variant={r.model === 'vapi' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {r.model}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {r.model === 'vapi' ? (
                        r.vapiMinutes != null ? (
                          `${r.vapiMinutes.toFixed(1)} min`
                        ) : (
                          '—'
                        )
                      ) : (
                        `${r.inputTokens.toLocaleString()} / ${r.outputTokens.toLocaleString()} tok`
                      )}
                    </td>
                    <td className="py-2 text-right font-mono">{fmt(r.estimatedCost)}</td>
                    <td className="py-2 text-right text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
