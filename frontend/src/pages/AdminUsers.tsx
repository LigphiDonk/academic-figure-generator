import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../components/ui/dialog';
import {
    RefreshCw,
    Shield,
    Users,
    UserPlus,
    Trash2,
    Coins,
    Pencil,
    ShieldCheck,
    Ban,
    CheckCircle2,
} from 'lucide-react';

interface AdminUser {
    id: string;
    email: string;
    display_name: string | null;
    is_active: boolean;
    is_admin: boolean;
    balance_cny: number;
    nanobanana_images_quota: number;
    prompt_ai_tokens_quota: number;
    created_at: string;
    updated_at: string | null;
}

type AdminUsageSummary = {
    billing_period: string;
    total_users: number;
    total_balance_cny: number;
    period_cost_cny: number;
    total_cost_cny: number;
    period_images: number;
    period_prompt_ai_tokens: number;
    daily: Array<{ date: string; cost_cny: number; images: number; prompt_ai_tokens: number }>;
};

export function AdminUsers() {
    const { user: currentUser } = useAuthStore();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    // Create user dialog
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [createForm, setCreateForm] = useState({
        email: '',
        password: '',
        display_name: '',
        is_admin: false,
        balance_cny: 0,
    });
    const [isCreating, setIsCreating] = useState(false);

    // Credit adjustment dialog
    const [showCreditDialog, setShowCreditDialog] = useState(false);
    const [creditTarget, setCreditTarget] = useState<AdminUser | null>(null);
    const [creditDelta, setCreditDelta] = useState('');
    const [isAdjustingCredit, setIsAdjustingCredit] = useState(false);

    // Edit user dialog
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
    const [editForm, setEditForm] = useState({
        display_name: '',
        is_active: true,
        is_admin: false,
    });
    const [isEditing, setIsEditing] = useState(false);

    // Delete confirmation dialog
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        fetchUsers();
        fetchSummary();
    }, []);

    const fetchUsers = async () => {
        setIsLoading(true);
        setError('');
        try {
            const res = await api.get('/admin/users');
            setUsers(res.data);
        } catch (e: any) {
            setError('获取用户列表失败');
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSummary = async () => {
        try {
            const res = await api.get('/admin/usage/summary');
            setSummary(res.data);
        } catch (e) {
            console.error('Failed to fetch admin usage summary', e);
            setSummary(null);
        }
    };

    // --- Create user ---
    const handleCreate = async () => {
        setIsCreating(true);
        try {
            await api.post('/admin/users', createForm);
            setShowCreateDialog(false);
            setCreateForm({ email: '', password: '', display_name: '', is_admin: false, balance_cny: 0 });
            await fetchUsers();
            await fetchSummary();
        } catch (e: any) {
            alert(e.response?.data?.detail || '创建用户失败');
        } finally {
            setIsCreating(false);
        }
    };

    // --- Edit user ---
    const openEditDialog = (u: AdminUser) => {
        setEditTarget(u);
        setEditForm({
            display_name: u.display_name || '',
            is_active: u.is_active,
            is_admin: u.is_admin,
        });
        setShowEditDialog(true);
    };

    const handleEdit = async () => {
        if (!editTarget) return;
        setIsEditing(true);
        try {
            await api.put(`/admin/users/${editTarget.id}`, editForm);
            setShowEditDialog(false);
            await fetchUsers();
            await fetchSummary();
        } catch (e: any) {
            alert(e.response?.data?.detail || '修改用户失败');
        } finally {
            setIsEditing(false);
        }
    };

    // --- Delete user ---
    const openDeleteDialog = (u: AdminUser) => {
        setDeleteTarget(u);
        setShowDeleteDialog(true);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await api.delete(`/admin/users/${deleteTarget.id}`);
            setShowDeleteDialog(false);
            await fetchUsers();
            await fetchSummary();
        } catch (e: any) {
            alert(e.response?.data?.detail || '删除用户失败');
        } finally {
            setIsDeleting(false);
        }
    };

    // --- Adjust balance ---
    const openCreditDialog = (u: AdminUser) => {
        setCreditTarget(u);
        setCreditDelta('');
        setShowCreditDialog(true);
    };

    const handleCreditAdjust = async () => {
        if (!creditTarget) return;
        const deltaCny = parseFloat(creditDelta);
        if (isNaN(deltaCny) || deltaCny === 0) {
            alert('请输入有效的余额调整值（正数增加，负数减少）');
            return;
        }
        setIsAdjustingCredit(true);
        try {
            await api.post(`/admin/users/${creditTarget.id}/balance`, { delta_cny: deltaCny });
            setShowCreditDialog(false);
            await fetchUsers();
            await fetchSummary();
        } catch (e: any) {
            alert(e.response?.data?.detail || '调整余额失败');
        } finally {
            setIsAdjustingCredit(false);
        }
    };

    // --- Quick toggle ---
    const toggleActive = async (u: AdminUser) => {
        try {
            await api.put(`/admin/users/${u.id}`, { is_active: !u.is_active });
            await fetchUsers();
            await fetchSummary();
        } catch (e: any) {
            alert(e.response?.data?.detail || '操作失败');
        }
    };

    if (!currentUser?.is_admin) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <Shield className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
                    <h2 className="text-xl font-semibold text-muted-foreground">权限不足</h2>
                    <p className="text-sm text-muted-foreground mt-1">您需要管理员权限才能访问此页面。</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Users className="w-7 h-7 text-primary" />
                        用户管理
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        管理所有用户账户、权限和余额。新注册用户初始余额为 0。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        刷新
                    </Button>
                    <Button size="sm" onClick={() => setShowCreateDialog(true)}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        创建用户
                    </Button>
                </div>
            </div>

            {/* User Stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">总用户数</div>
                    <div className="text-2xl font-bold mt-1">{users.length}</div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">活跃用户</div>
                    <div className="text-2xl font-bold mt-1 text-green-600">
                        {users.filter(u => u.is_active).length}
                    </div>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <div className="text-sm text-muted-foreground">管理员</div>
                    <div className="text-2xl font-bold mt-1 text-blue-600">
                        {users.filter(u => u.is_admin).length}
                    </div>
                </div>
            </div>

            {/* Site Summary */}
            {summary && (
                <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">网站总体用量（{summary.billing_period}）</div>
                        <Button variant="outline" size="sm" onClick={fetchSummary}>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            刷新统计
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">总余额</div>
                            <div className="text-lg font-bold mt-1">¥{summary.total_balance_cny.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">本期花费</div>
                            <div className="text-lg font-bold mt-1">¥{summary.period_cost_cny.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">累计花费</div>
                            <div className="text-lg font-bold mt-1">¥{summary.total_cost_cny.toFixed(2)}</div>
                        </div>
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">本期图片</div>
                            <div className="text-lg font-bold mt-1">{summary.period_images}</div>
                        </div>
                        <div className="rounded-md border p-3">
                            <div className="text-xs text-muted-foreground">本期提示词生成 Tokens</div>
                            <div className="text-lg font-bold mt-1">{summary.period_prompt_ai_tokens.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Simple daily cost bars */}
                    <div className="pt-2">
                        <div className="text-xs text-muted-foreground mb-2">近 30 天花费（¥）</div>
                        <div className="flex items-end gap-1 h-24">
                            {(() => {
                                const points = summary.daily || [];
                                const max = Math.max(1, ...points.map(p => p.cost_cny || 0));
                                return points.map((p, idx) => (
                                    <div key={idx} className="flex-1 min-w-0">
                                        <div
                                            className="w-full rounded-sm bg-primary/70"
                                            style={{ height: `${Math.max(2, (p.cost_cny / max) * 100)}%` }}
                                            title={`${p.date}: ¥${p.cost_cny.toFixed(2)}`}
                                        />
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                    {error}
                </div>
            )}

            {/* User Table */}
            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="rounded-lg border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>邮箱</TableHead>
                                <TableHead>昵称</TableHead>
                                <TableHead>角色</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead className="text-center">余额（¥）</TableHead>
                                <TableHead>注册时间</TableHead>
                                <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        暂无用户
                                    </TableCell>
                                </TableRow>
                            ) : (
                                users.map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell className="font-medium">{u.email}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {u.display_name || '—'}
                                        </TableCell>
                                        <TableCell>
                                            {u.is_admin ? (
                                                <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
                                                    <ShieldCheck className="w-3 h-3 mr-1" />
                                                    管理员
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">普通用户</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {u.is_active ? (
                                                <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                                    正常
                                                </Badge>
                                            ) : (
                                                <Badge variant="destructive">
                                                    <Ban className="w-3 h-3 mr-1" />
                                                    已禁用
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={`font-mono font-bold text-lg ${u.balance_cny > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {u.balance_cny.toFixed(2)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {new Date(u.created_at).toLocaleDateString('zh-CN')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openCreditDialog(u)}
                                                    title="调整余额"
                                                >
                                                    <Coins className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditDialog(u)}
                                                    title="编辑用户"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => toggleActive(u)}
                                                    title={u.is_active ? '禁用' : '启用'}
                                                    disabled={u.id === currentUser?.id?.toString()}
                                                >
                                                    {u.is_active ? (
                                                        <Ban className="w-4 h-4 text-orange-500" />
                                                    ) : (
                                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openDeleteDialog(u)}
                                                    title="删除用户"
                                                    disabled={u.id === currentUser?.id?.toString()}
                                                >
                                                    <Trash2 className="w-4 h-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* ===== Create User Dialog ===== */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>创建新用户</DialogTitle>
                        <DialogDescription>
                            填写以下信息创建一个新用户账户。新用户默认余额为 0。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="create_email">邮箱 *</Label>
                            <Input
                                id="create_email"
                                type="email"
                                placeholder="user@example.com"
                                value={createForm.email}
                                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create_password">密码 *</Label>
                            <Input
                                id="create_password"
                                type="password"
                                placeholder="至少 6 个字符"
                                value={createForm.password}
                                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create_name">显示昵称</Label>
                            <Input
                                id="create_name"
                                placeholder="用户昵称（可选）"
                                value={createForm.display_name}
                                onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="create_balance">初始余额（¥）</Label>
                            <Input
                                id="create_balance"
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder="0.00"
                                value={createForm.balance_cny}
                                onChange={(e) => setCreateForm({ ...createForm, balance_cny: parseFloat(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <input
                                id="create_admin"
                                type="checkbox"
                                className="rounded border-gray-300"
                                checked={createForm.is_admin}
                                onChange={(e) => setCreateForm({ ...createForm, is_admin: e.target.checked })}
                            />
                            <Label htmlFor="create_admin" className="cursor-pointer">设为管理员</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateDialog(false)}>取消</Button>
                        <Button onClick={handleCreate} disabled={isCreating || !createForm.email || !createForm.password}>
                            {isCreating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                            创建
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ===== Edit User Dialog ===== */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑用户</DialogTitle>
                        <DialogDescription>
                            修改 {editTarget?.email} 的信息
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor="edit_name">显示昵称</Label>
                            <Input
                                id="edit_name"
                                value={editForm.display_name}
                                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <input
                                id="edit_active"
                                type="checkbox"
                                className="rounded border-gray-300"
                                checked={editForm.is_active}
                                onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                                disabled={editTarget?.id === currentUser?.id?.toString()}
                            />
                            <Label htmlFor="edit_active" className="cursor-pointer">账户启用</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <input
                                id="edit_admin"
                                type="checkbox"
                                className="rounded border-gray-300"
                                checked={editForm.is_admin}
                                onChange={(e) => setEditForm({ ...editForm, is_admin: e.target.checked })}
                                disabled={editTarget?.id === currentUser?.id?.toString()}
                            />
                            <Label htmlFor="edit_admin" className="cursor-pointer">管理员权限</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEditDialog(false)}>取消</Button>
                        <Button onClick={handleEdit} disabled={isEditing}>
                            {isEditing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ===== Credit Adjustment Dialog ===== */}
            <Dialog open={showCreditDialog} onOpenChange={setShowCreditDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>调整余额</DialogTitle>
                        <DialogDescription>
                            用户：{creditTarget?.email}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="text-center p-4 rounded-lg bg-muted/50">
                            <div className="text-sm text-muted-foreground">当前余额（¥）</div>
                            <div className={`text-4xl font-bold mt-1 ${(creditTarget?.balance_cny ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {(creditTarget?.balance_cny ?? 0).toFixed(2)}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="credit_delta">调整金额（¥）</Label>
                            <Input
                                id="credit_delta"
                                type="number"
                                step="0.01"
                                placeholder="正数增加，负数减少（如 10 或 -5）"
                                value={creditDelta}
                                onChange={(e) => setCreditDelta(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                输入正数增加余额，输入负数减少余额。
                            </p>
                        </div>
                        {creditDelta && !isNaN(parseFloat(creditDelta)) && parseFloat(creditDelta) !== 0 && (
                            <div className="text-center p-3 rounded-lg border">
                                <span className="text-sm text-muted-foreground">调整后余额：</span>
                                <span className="text-lg font-bold ml-2">
                                    {((creditTarget?.balance_cny ?? 0) + parseFloat(creditDelta)).toFixed(2)}
                                </span>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreditDialog(false)}>取消</Button>
                        <Button onClick={handleCreditAdjust} disabled={isAdjustingCredit || !creditDelta}>
                            {isAdjustingCredit && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                            确认调整
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ===== Delete Confirmation Dialog ===== */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认删除</DialogTitle>
                        <DialogDescription>
                            确定要删除用户 <strong>{deleteTarget?.email}</strong> 吗？此操作不可撤销，该用户的所有数据将被永久删除。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>取消</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                            {isDeleting && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                            确认删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
