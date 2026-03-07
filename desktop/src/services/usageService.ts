import type { ApiUsageLog } from '../types/models';
import { billingPeriodFromDate, isoNow, monthKey, monthLabel } from '../lib/utils';
import { mutateSnapshot, readSnapshot } from './storage';

export class UsageService {
  async recordUsage(log: Omit<ApiUsageLog, 'id' | 'billingPeriod' | 'createdAt'>): Promise<ApiUsageLog> {
    return mutateSnapshot((snapshot) => {
      const usageLog: ApiUsageLog = {
        id: crypto.randomUUID(),
        billingPeriod: billingPeriodFromDate(new Date()),
        createdAt: isoNow(),
        ...log,
      };
      snapshot.usageLogs.push(usageLog);
      return usageLog;
    });
  }

  async listUsageLogs(): Promise<ApiUsageLog[]> {
    const snapshot = await readSnapshot();
    return [...snapshot.usageLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getDashboard() {
    const logs = await this.listUsageLogs();
    const now = new Date();
    const currentMonth = monthKey(now);
    const monthLogs = logs.filter((item) => item.billingPeriod === currentMonth && item.isSuccess);

    const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
      const target = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const key = monthKey(target);
      const scoped = logs.filter((item) => item.billingPeriod === key && item.isSuccess);
      return {
        key,
        label: monthLabel(target),
        claudeTokens: scoped.reduce((sum, item) => sum + (item.inputTokens ?? 0) + (item.outputTokens ?? 0), 0),
        images: scoped.filter((item) => item.apiName === 'nanobanana').length,
      };
    });

    const projectBreakdown = Object.values(
      logs.reduce<Record<string, { projectId: string; requests: number }>>((acc, item) => {
        if (!item.projectId) return acc;
        acc[item.projectId] ??= { projectId: item.projectId, requests: 0 };
        acc[item.projectId].requests += 1;
        return acc;
      }, {}),
    ).sort((a, b) => b.requests - a.requests);

    return {
      logs,
      overview: {
        claudeTokens: monthLogs.reduce((sum, item) => sum + (item.inputTokens ?? 0) + (item.outputTokens ?? 0), 0),
        claudeRequests: monthLogs.filter((item) => item.apiName === 'claude').length,
        generatedImages: monthLogs.filter((item) => item.apiName === 'nanobanana').length,
        failedCalls: logs.filter((item) => item.billingPeriod === currentMonth && !item.isSuccess).length,
      },
      monthlyTrend,
      projectBreakdown,
    };
  }
}

export const usageService = new UsageService();
