import { useEffect, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { formatDate } from '../lib/utils';
import { projectService } from '../services/projectService';
import { usageService } from '../services/usageService';
import type { ApiUsageLog } from '../types/models';

interface DashboardState {
  logs: ApiUsageLog[];
  overview: { claudeTokens: number; claudeRequests: number; generatedImages: number; failedCalls: number };
  monthlyTrend: Array<{ key: string; label: string; claudeTokens: number; images: number }>;
  projectBreakdown: Array<{ projectId: string; requests: number }>;
}

export function Usage() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = async () => {
      const [usageDashboard, projects] = await Promise.all([usageService.getDashboard(), projectService.listProjects()]);
      setDashboard(usageDashboard);
      setProjectNames(Object.fromEntries(projects.map((project) => [project.id, project.name])));
    };
    void load();
  }, []);

  const maxTokens = Math.max(...(dashboard?.monthlyTrend.map((item) => item.claudeTokens) ?? [1]));
  const maxImages = Math.max(...(dashboard?.monthlyTrend.map((item) => item.images) ?? [1]));

  return (
    <div className="space-y-6">
      <div><div className="text-xs uppercase tracking-[0.24em] text-slate-400">Usage Analytics</div><h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">本地用量统计</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">所有调用记录只保存在本地，用于帮助你估算 Claude token 和图片生成消耗。</p></div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50"><CardHeader><CardDescription>本月 Claude Token</CardDescription><CardTitle>{dashboard?.overview.claudeTokens ?? 0}</CardTitle></CardHeader></Card>
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50"><CardHeader><CardDescription>本月 Claude 请求</CardDescription><CardTitle>{dashboard?.overview.claudeRequests ?? 0}</CardTitle></CardHeader></Card>
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50"><CardHeader><CardDescription>本月图片生成</CardDescription><CardTitle>{dashboard?.overview.generatedImages ?? 0}</CardTitle></CardHeader></Card>
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50"><CardHeader><CardDescription>本月失败调用</CardDescription><CardTitle>{dashboard?.overview.failedCalls ?? 0}</CardTitle></CardHeader></Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
          <CardHeader><CardTitle>近 6 个月趋势</CardTitle><CardDescription>左侧蓝柱是 Claude token，右侧深色柱是图片生成次数。</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-6">
            {dashboard?.monthlyTrend.map((item) => (
              <div key={item.key} className="flex flex-col items-center gap-3 rounded-2xl bg-slate-50 p-4">
                <div className="flex h-44 items-end gap-2">
                  <div className="w-5 rounded-full bg-sky-500/85" style={{ height: `${Math.max((item.claudeTokens / maxTokens) * 160, 8)}px` }} />
                  <div className="w-5 rounded-full bg-slate-900" style={{ height: `${Math.max((item.images / maxImages) * 160, 8)}px` }} />
                </div>
                <div className="text-center text-xs text-slate-500"><div>{item.label}</div><div>{item.claudeTokens} tokens</div><div>{item.images} images</div></div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
          <CardHeader><CardTitle>项目占比</CardTitle><CardDescription>按项目聚合的 API 调用数量。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {dashboard?.projectBreakdown.length ? dashboard.projectBreakdown.map((item) => <div key={item.projectId} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm"><span className="font-medium text-slate-900">{projectNames[item.projectId] ?? '未知项目'}</span><Badge variant="secondary">{item.requests} 次</Badge></div>) : <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">还没有记录到任何项目级调用。</div>}
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
        <CardHeader><CardTitle>调用明细</CardTitle><CardDescription>最近的本地使用记录。</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {dashboard?.logs.length ? dashboard.logs.slice(0, 20).map((log) => (
            <div key={log.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={log.isSuccess ? 'secondary' : 'destructive'}>{log.apiName}</Badge>
                  {log.claudeModel ? <Badge variant="outline">{log.claudeModel}</Badge> : null}
                  {log.resolution ? <Badge variant="outline">{log.resolution}</Badge> : null}
                  {log.aspectRatio ? <Badge variant="outline">{log.aspectRatio}</Badge> : null}
                </div>
                <div className="text-sm text-slate-600">{projectNames[log.projectId ?? ''] ?? '直接生成 / 全局设置'} · {formatDate(log.createdAt)}</div>
              </div>
              <div className="text-sm text-slate-500"><div>输入/输出：{log.inputTokens ?? 0} / {log.outputTokens ?? 0}</div><div>耗时：{log.requestDurationMs ?? 0} ms</div></div>
            </div>
          )) : <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">目前还没有任何调用记录。</div>}
        </CardContent>
      </Card>
    </div>
  );
}
