import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { RefreshCw, CheckCircle2, Lock } from 'lucide-react';

export function Settings() {
    const { user, updateUser } = useAuthStore();
    const [isLoading, setIsLoading] = useState(false);
    const [success, setSuccess] = useState('');

    const [passwordData, setPasswordData] = useState({
        current_password: '',
        new_password: '',
        confirm_password: '',
    });
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [passwordError, setPasswordError] = useState('');

    const [formData, setFormData] = useState({
        display_name: user?.display_name || '',
        claude_api_key: '',
        nanobanana_api_key: '',
        claude_api_base_url: user?.claude_api_base_url || '',
        nanobanana_api_base_url: user?.nanobanana_api_base_url || '',
    });

    useEffect(() => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                display_name: user.display_name,
                claude_api_base_url: user.claude_api_base_url || '',
                nanobanana_api_base_url: user.nanobanana_api_base_url || '',
            }));
        }
    }, [user]);

    const handleSave = async () => {
        setIsLoading(true);
        setSuccess('');
        try {
            const payload: any = {
                display_name: formData.display_name,
                claude_api_base_url: formData.claude_api_base_url || null,
                nanobanana_api_base_url: formData.nanobanana_api_base_url || null,
            };

            if (formData.claude_api_key) payload.claude_api_key = formData.claude_api_key;
            if (formData.nanobanana_api_key) payload.nanobanana_api_key = formData.nanobanana_api_key;

            const res = await api.put('/auth/me', payload);
            updateUser(res.data);
            setSuccess('设置保存成功！');

            // Clear api keys from form data after save
            setFormData(prev => ({ ...prev, claude_api_key: '', nanobanana_api_key: '' }));
        } catch (e) {
            console.error(e);
            alert('保存设置失败，请重试');
        } finally {
            setIsLoading(false);
        }
    };

    if (!user) return null;

    const hasPassword = !user.linuxdo_id || user.email?.indexOf('@linuxdo.local') === -1;

    const handleChangePassword = async () => {
        setPasswordError('');
        setPasswordSuccess('');

        if (passwordData.new_password !== passwordData.confirm_password) {
            setPasswordError('两次输入的新密码不一致');
            return;
        }
        if (passwordData.new_password.length < 8) {
            setPasswordError('新密码至少需要 8 个字符');
            return;
        }

        setPasswordLoading(true);
        try {
            await api.put('/auth/me/password', {
                current_password: passwordData.current_password,
                new_password: passwordData.new_password,
            });
            setPasswordSuccess('密码修改成功！');
            setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
        } catch (err: any) {
            setPasswordError(err.response?.data?.detail || '密码修改失败，请重试');
        } finally {
            setPasswordLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">应用设置</h1>
                <p className="text-muted-foreground mt-1">管理您的个人资料、默认偏好及自定义 API 配置。</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>个人资料</CardTitle>
                    <CardDescription>更新您的基础账户信息。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email">注册邮箱</Label>
                        <Input id="email" value={user.email} disabled />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="display_name">显示名称</Label>
                        <Input
                            id="display_name"
                            value={formData.display_name}
                            onChange={e => setFormData({ ...formData, display_name: e.target.value })}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Change Password */}
            {hasPassword && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Lock className="w-5 h-5" />
                            修改密码
                        </CardTitle>
                        <CardDescription>更新您的登录密码。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="current_password">当前密码</Label>
                            <Input
                                id="current_password"
                                type="password"
                                placeholder="请输入当前密码"
                                value={passwordData.current_password}
                                onChange={e => setPasswordData({ ...passwordData, current_password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="new_password">新密码</Label>
                            <Input
                                id="new_password"
                                type="password"
                                placeholder="至少 8 个字符"
                                value={passwordData.new_password}
                                onChange={e => setPasswordData({ ...passwordData, new_password: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirm_password">确认新密码</Label>
                            <Input
                                id="confirm_password"
                                type="password"
                                placeholder="再次输入新密码"
                                value={passwordData.confirm_password}
                                onChange={e => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                        <div>
                            {passwordSuccess && <p className="text-sm text-green-600 font-medium">{passwordSuccess}</p>}
                            {passwordError && <p className="text-sm text-red-600 font-medium">{passwordError}</p>}
                        </div>
                        <Button onClick={handleChangePassword} disabled={passwordLoading}>
                            {passwordLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                            修改密码
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>BYOK API 配置</CardTitle>
                    <CardDescription>绑定您自己的 API Key 和请求地址 (Bring Your Own Key)，优先使用自有配置。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Claude Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-foreground">Claude API (Anthropic)</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="claude">API Key</Label>
                                {user.claude_api_key_set && (
                                    <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                                )}
                            </div>
                            <Input
                                id="claude"
                                type="password"
                                placeholder={user.claude_api_key_set ? "sk-ant-**** (通过 API 设置)" : "sk-ant-..."}
                                value={formData.claude_api_key}
                                onChange={e => setFormData({ ...formData, claude_api_key: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="claude_url">请求地址</Label>
                            <Input
                                id="claude_url"
                                placeholder="https://api.anthropic.com （留空使用系统默认）"
                                value={formData.claude_api_base_url}
                                onChange={e => setFormData({ ...formData, claude_api_base_url: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">如使用代理或中转服务，请填写 API 基础地址（不含 /v1/messages 路径）。</p>
                        </div>
                    </div>

                    <hr className="border-muted" />

                    {/* NanoBanana Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-foreground">NanoBanana 配图服务</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="nanobanana">API Key</Label>
                                {user.nanobanana_api_key_set && (
                                    <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                                )}
                            </div>
                            <Input
                                id="nanobanana"
                                type="password"
                                placeholder={user.nanobanana_api_key_set ? "sk-****" : "输入配图服务 API Key"}
                                value={formData.nanobanana_api_key}
                                onChange={e => setFormData({ ...formData, nanobanana_api_key: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="nb_url">请求地址</Label>
                            <Input
                                id="nb_url"
                                placeholder="https://api.keepgo.icu （留空使用系统默认）"
                                value={formData.nanobanana_api_base_url}
                                onChange={e => setFormData({ ...formData, nanobanana_api_base_url: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">如使用代理或中转服务，请填写 API 基础地址。</p>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                    <div>
                        {success && <p className="text-sm text-green-600 font-medium">{success}</p>}
                    </div>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存设置
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
