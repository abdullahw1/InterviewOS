import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function getCostStats() {
  const records = await prisma.costRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const totalCost = records.reduce((sum, record) => sum + record.estimatedCost, 0);

  const byFeature = records.reduce((acc, record) => {
    acc[record.feature] = (acc[record.feature] || 0) + record.estimatedCost;
    return acc;
  }, {} as Record<string, number>);

  const byModel = records.reduce((acc, record) => {
    acc[record.model] = (acc[record.model] || 0) + record.estimatedCost;
    return acc;
  }, {} as Record<string, number>);

  return { totalCost, byFeature, byModel, recentRecords: records.slice(0, 10) };
}

export default async function CostsPage() {
  const stats = await getCostStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cost Tracker</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Monitor your OpenAI API usage and costs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Total Estimated Cost</CardTitle>
            <CardDescription>All-time spending</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">${stats.totalCost.toFixed(4)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By Feature</CardTitle>
            <CardDescription>Cost breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stats.byFeature).map(([feature, cost]) => (
                <div key={feature} className="flex justify-between text-sm">
                  <span className="capitalize">{feature}</span>
                  <span className="font-medium">${cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By Model</CardTitle>
            <CardDescription>Model usage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stats.byModel).map(([model, cost]) => (
                <div key={model} className="flex justify-between text-sm">
                  <span className="text-xs">{model}</span>
                  <span className="font-medium">${cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent API Calls</CardTitle>
          <CardDescription>Last 10 tracked calls</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Feature</th>
                  <th className="text-left py-2">Model</th>
                  <th className="text-right py-2">Input Tokens</th>
                  <th className="text-right py-2">Output Tokens</th>
                  <th className="text-right py-2">Cost</th>
                  <th className="text-right py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRecords.map((record) => (
                  <tr key={record.id} className="border-b">
                    <td className="py-2 capitalize">{record.feature}</td>
                    <td className="py-2 text-xs">{record.model}</td>
                    <td className="py-2 text-right">{record.inputTokens.toLocaleString()}</td>
                    <td className="py-2 text-right">{record.outputTokens.toLocaleString()}</td>
                    <td className="py-2 text-right">${record.estimatedCost.toFixed(4)}</td>
                    <td className="py-2 text-right text-xs">
                      {new Date(record.createdAt).toLocaleDateString()}
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
