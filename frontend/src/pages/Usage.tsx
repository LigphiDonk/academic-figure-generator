import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Coins, Image as ImageIcon, MessageSquare } from 'lucide-react';

type UsageSummary = {
    billing_period: string;
    balance_cny: number;
    claude_tokens_used: number;
    claude_calls: number;
    nanobanana_images: number;
    period_spend_cny: number;
    total_spend_cny: number;
};

type UsageBreakdownItem = {
    api_name: string;
    total_calls: number;
    success_count: number;
    failure_count: number;
    total_tokens: number | null;
    total_cost_cny: number;
    avg_duration_ms: number;
};

type UsageHistoryPoint = {
    date: string;
    claude_tokens: number;
    nanobanana_images: number;
    cost_cny: number;
};

export function Usage() {
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [breakdown, setBreakdown] = useState<UsageBreakdownItem[]>([]);
    const [history, setHistory] = useState<UsageHistoryPoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchUsageData();
    }, []);

    const fetchUsageData = async () => {
        setIsLoading(true);
        try {
            const summaryRes = await api.get('/usage/summary');
            setSummary(summaryRes.data);

            const breakdownRes = await api.get('/usage/breakdown');
            setBreakdown(breakdownRes.data);

            const historyRes = await api.get('/usage/history', { params: { period: 'daily', limit: 30 } });
            setHistory(historyRes.data?.data || []);
        } catch (e) {
            console.error(e);
            setSummary(null);
            setBreakdown([]);
            setHistory([]);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading && !summary) return <div className="p-8">加载用量数据中...</div>;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">用量看板</h1>
                <p className="text-muted-foreground mt-1">查看 {summary?.billing_period} 账单周期的用量与费用</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">本期花费</CardTitle>
                        <Coins className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">¥{(summary?.period_spend_cny || 0).toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground mt-1">累计花费：¥{(summary?.total_spend_cny || 0).toFixed(2)}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">余额</CardTitle>
                        <Coins className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">¥{(summary?.balance_cny || 0).toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground mt-1">不足时请联系管理员充值</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Claude Token 消耗</CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{(summary?.claude_tokens_used || 0).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground mt-1">调用次数：{summary?.claude_calls || 0}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">已生成配图</CardTitle>
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary?.nanobanana_images || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">按成功生成计费</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="breakdown" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="breakdown">API 消耗明细</TabsTrigger>
                    <TabsTrigger value="history">历史趋势</TabsTrigger>
                </TabsList>
                <TabsContent value="breakdown" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>模型调用分布</CardTitle>
                            <CardDescription>详细查看各项 API 的调用次数、成功率与费用。</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>模型 / API</TableHead>
                                        <TableHead className="text-right">调用次数</TableHead>
                                        <TableHead className="text-right">成功率</TableHead>
                                        <TableHead className="text-right">Token 消耗</TableHead>
                                        <TableHead className="text-right">平均延迟</TableHead>
                                        <TableHead className="text-right">预估花费</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {breakdown.map((item, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-medium">{item.api_name}</TableCell>
                                            <TableCell className="text-right">{item.total_calls}</TableCell>
                                            <TableCell className="text-right">
                                                {item.total_calls > 0 ? Math.round((item.success_count / item.total_calls) * 100) : 0}%
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {item.total_tokens && item.total_tokens > 0 ? item.total_tokens.toLocaleString() : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{(item.avg_duration_ms / 1000).toFixed(1)}s</TableCell>
                                            <TableCell className="text-right">¥{(item.total_cost_cny || 0).toFixed(2)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="history" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>历史用量趋势</CardTitle>
                            <CardDescription>查看过去 30 天的 API 调用和费用趋势。</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>日期</TableHead>
                                        <TableHead className="text-right">Claude Tokens</TableHead>
                                        <TableHead className="text-right">图片</TableHead>
                                        <TableHead className="text-right">花费（¥）</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                                                暂无数据
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        history.map((p, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell>{p.date}</TableCell>
                                                <TableCell className="text-right">{(p.claude_tokens || 0).toLocaleString()}</TableCell>
                                                <TableCell className="text-right">{p.nanobanana_images || 0}</TableCell>
                                                <TableCell className="text-right">¥{(p.cost_cny || 0).toFixed(2)}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
