import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Coins, Image as ImageIcon, MessageSquare, Plus, CheckCircle2, Loader2 } from 'lucide-react';

type UsageSummary = {
    billing_period: string;
    balance_cny: number;
    prompt_ai_tokens_used: number;
    prompt_ai_calls: number;
    nanobanana_images: number;
    period_spend_cny: number;
    total_spend_cny: number;
};

type UsageBreakdownItem = {
    api_name: string;
    provider: string | null;
    model: string | null;
    total_calls: number;
    success_count: number;
    failure_count: number;
    total_tokens: number | null;
    total_cost_cny: number;
    avg_duration_ms: number;
};

type UsageHistoryPoint = {
    date: string;
    prompt_ai_tokens: number;
    nanobanana_images: number;
    cost_cny: number;
};

type PaymentConfig = {
    configured: boolean;
    credits_per_cny: number | null;
};

type PaymentHistoryItem = {
    order_id: string;
    out_trade_no: string;
    amount_cny: number;
    amount_credits: number;
    status: string;
    created_at: string;
};

export function Usage() {
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [breakdown, setBreakdown] = useState<UsageBreakdownItem[]>([]);
    const [history, setHistory] = useState<UsageHistoryPoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Payment state
    const [payConfig, setPayConfig] = useState<PaymentConfig>({ configured: false, credits_per_cny: null });
    const [showRecharge, setShowRecharge] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState('');
    const [isCreatingOrder, setIsCreatingOrder] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState<'idle' | 'waiting' | 'success' | 'failed'>('idle');
    const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        fetchUsageData();
        fetchPaymentConfig();
        fetchPaymentHistory();
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    const fetchPaymentConfig = async () => {
        try {
            const res = await api.get('/payment/config');
            setPayConfig(res.data);
        } catch {
            setPayConfig({ configured: false, credits_per_cny: null });
        }
    };

    const fetchPaymentHistory = async () => {
        try {
            const res = await api.get('/payment/history');
            setPaymentHistory(res.data || []);
        } catch {
            setPaymentHistory([]);
        }
    };

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

    const handleRecharge = async () => {
        const amount = parseFloat(rechargeAmount);
        if (!amount || amount <= 0) return;

        setIsCreatingOrder(true);
        try {
            const res = await api.post('/payment/create', { amount_cny: amount });
            const { order_id, pay_url } = res.data;

            // Open payment page
            window.open(pay_url, '_blank');

            // Start polling
            setPaymentStatus('waiting');
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = setInterval(async () => {
                try {
                    const statusRes = await api.get(`/payment/status/${order_id}`);
                    if (statusRes.data.status === 'paid') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        pollRef.current = null;
                        setPaymentStatus('success');
                        // Refresh data
                        fetchUsageData();
                        fetchPaymentHistory();
                        // Auto-close after 2s
                        setTimeout(() => {
                            setShowRecharge(false);
                            setPaymentStatus('idle');
                            setRechargeAmount('');
                        }, 2000);
                    } else if (statusRes.data.status === 'failed') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        pollRef.current = null;
                        setPaymentStatus('failed');
                    }
                } catch {
                    // Polling error, keep trying
                }
            }, 3000);
        } catch (e: any) {
            alert(e?.response?.data?.detail || '创建订单失败');
        } finally {
            setIsCreatingOrder(false);
        }
    };

    const creditsNeeded = rechargeAmount && payConfig.credits_per_cny
        ? (parseFloat(rechargeAmount) * payConfig.credits_per_cny).toFixed(2)
        : null;

    const formatUsageName = (item: UsageBreakdownItem) => {
        if (item.api_name === 'prompt_ai') {
            const provider = item.provider || 'unknown';
            return item.model ? `prompt_ai / ${provider} / ${item.model}` : `prompt_ai / ${provider}`;
        }
        return item.model ? `${item.api_name} / ${item.model}` : item.api_name;
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
                        {payConfig.configured ? (
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-2 h-7 text-xs"
                                onClick={() => { setShowRecharge(true); setPaymentStatus('idle'); }}
                            >
                                <Plus className="h-3 w-3 mr-1" />
                                充值
                            </Button>
                        ) : (
                            <p className="text-xs text-muted-foreground mt-1">不足时请联系管理员充值</p>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">提示词生成 Token 消耗</CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{(summary?.prompt_ai_tokens_used || 0).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground mt-1">调用次数：{summary?.prompt_ai_calls || 0}</p>
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
                                            <TableCell className="font-medium">{formatUsageName(item)}</TableCell>
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
                                        <TableHead className="text-right">提示词生成 Tokens</TableHead>
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
                                                <TableCell className="text-right">{(p.prompt_ai_tokens || 0).toLocaleString()}</TableCell>
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

            {/* Payment History */}
            {payConfig.configured && paymentHistory.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>充值记录</CardTitle>
                        <CardDescription>最近的 Linux DO 积分充值记录</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>订单号</TableHead>
                                    <TableHead className="text-right">金额（¥）</TableHead>
                                    <TableHead className="text-right">积分</TableHead>
                                    <TableHead className="text-right">状态</TableHead>
                                    <TableHead className="text-right">时间</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paymentHistory.map((item) => (
                                    <TableRow key={item.order_id}>
                                        <TableCell className="font-mono text-xs">{item.out_trade_no}</TableCell>
                                        <TableCell className="text-right">¥{item.amount_cny.toFixed(2)}</TableCell>
                                        <TableCell className="text-right">{item.amount_credits.toFixed(2)}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={item.status === 'paid' ? 'text-green-600' : item.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}>
                                                {item.status === 'paid' ? '已完成' : item.status === 'failed' ? '失败' : '待支付'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right text-xs">{new Date(item.created_at).toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Recharge Dialog */}
            <Dialog open={showRecharge} onOpenChange={(open) => {
                if (!open && pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                }
                setShowRecharge(open);
                if (!open) { setPaymentStatus('idle'); setRechargeAmount(''); }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Linux DO 积分充值</DialogTitle>
                        <DialogDescription>使用 Linux DO 积分为账户充值余额</DialogDescription>
                    </DialogHeader>

                    {paymentStatus === 'success' ? (
                        <div className="flex flex-col items-center py-6 gap-3">
                            <CheckCircle2 className="h-12 w-12 text-green-500" />
                            <p className="text-lg font-semibold">充值成功！</p>
                            <p className="text-sm text-muted-foreground">余额已更新</p>
                        </div>
                    ) : paymentStatus === 'waiting' ? (
                        <div className="flex flex-col items-center py-6 gap-3">
                            <Loader2 className="h-10 w-10 animate-spin text-primary" />
                            <p className="text-sm font-medium">等待支付中...</p>
                            <p className="text-xs text-muted-foreground">请在弹出的页面中完成 Linux DO 积分授权</p>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-4 py-2">
                                <div className="space-y-2">
                                    <Label htmlFor="recharge_amount">充值金额（元）</Label>
                                    <Input
                                        id="recharge_amount"
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        placeholder="请输入充值金额"
                                        value={rechargeAmount}
                                        onChange={e => setRechargeAmount(e.target.value)}
                                    />
                                </div>
                                {creditsNeeded && parseFloat(rechargeAmount) > 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        需要 <span className="font-semibold text-foreground">{creditsNeeded}</span> Linux DO 积分
                                    </p>
                                )}
                            </div>
                            <DialogFooter>
                                <Button
                                    onClick={handleRecharge}
                                    disabled={isCreatingOrder || !rechargeAmount || parseFloat(rechargeAmount) <= 0}
                                >
                                    {isCreatingOrder && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    确认充值
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
