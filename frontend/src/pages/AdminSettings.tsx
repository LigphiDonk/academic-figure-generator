import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { RefreshCw, CheckCircle2, Shield, Server, Globe, Coins } from 'lucide-react';

interface SystemSettings {
    claude_api_key_set: boolean;
    claude_api_base_url: string | null;
    claude_model: string | null;
    nanobanana_api_key_set: boolean;
    nanobanana_api_base_url: string | null;
    nanobanana_model: string | null;
    image_price_cny: number | null;
    image_price_cny_1k: number | null;
    image_price_cny_2k: number | null;
    image_price_cny_4k: number | null;
    usd_cny_rate: number | null;
    claude_input_usd_per_million: number | null;
    claude_output_usd_per_million: number | null;
    linuxdo_client_id: string | null;
    linuxdo_client_secret_set: boolean;
    linuxdo_redirect_uri: string | null;
    epay_pid: string | null;
    epay_key_set: boolean;
    linuxdo_credits_per_cny: number | null;
}

export function AdminSettings() {
    const { user } = useAuthStore();
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [success, setSuccess] = useState('');

    const [settings, setSettings] = useState<SystemSettings>({
        claude_api_key_set: false,
        claude_api_base_url: null,
        claude_model: null,
        nanobanana_api_key_set: false,
        nanobanana_api_base_url: null,
        nanobanana_model: null,
        image_price_cny: null,
        image_price_cny_1k: null,
        image_price_cny_2k: null,
        image_price_cny_4k: null,
        usd_cny_rate: null,
        claude_input_usd_per_million: null,
        claude_output_usd_per_million: null,
        linuxdo_client_id: null,
        linuxdo_client_secret_set: false,
        linuxdo_redirect_uri: null,
        epay_pid: null,
        epay_key_set: false,
        linuxdo_credits_per_cny: null,
    });

    const [formData, setFormData] = useState({
        claude_api_key: '',
        claude_api_base_url: '',
        claude_model: '',
        nanobanana_api_key: '',
        nanobanana_api_base_url: '',
        nanobanana_model: '',
        image_price_cny: '',
        image_price_cny_1k: '',
        image_price_cny_2k: '',
        image_price_cny_4k: '',
        usd_cny_rate: '',
        claude_input_usd_per_million: '',
        claude_output_usd_per_million: '',
        linuxdo_client_id: '',
        linuxdo_client_secret: '',
        linuxdo_redirect_uri: '',
        epay_pid: '',
        epay_key: '',
        linuxdo_credits_per_cny: '',
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setIsFetching(true);
        try {
            const res = await api.get('/admin/settings');
            const data: SystemSettings = res.data;
            setSettings(data);
            setFormData(prev => ({
                ...prev,
                claude_api_base_url: data.claude_api_base_url || '',
                claude_model: data.claude_model || '',
                nanobanana_api_base_url: data.nanobanana_api_base_url || '',
                nanobanana_model: data.nanobanana_model || '',
                image_price_cny: data.image_price_cny != null ? String(data.image_price_cny) : '',
                image_price_cny_1k: data.image_price_cny_1k != null ? String(data.image_price_cny_1k) : '',
                image_price_cny_2k: data.image_price_cny_2k != null ? String(data.image_price_cny_2k) : '',
                image_price_cny_4k: data.image_price_cny_4k != null ? String(data.image_price_cny_4k) : '',
                usd_cny_rate: data.usd_cny_rate != null ? String(data.usd_cny_rate) : '',
                claude_input_usd_per_million: data.claude_input_usd_per_million != null ? String(data.claude_input_usd_per_million) : '',
                claude_output_usd_per_million: data.claude_output_usd_per_million != null ? String(data.claude_output_usd_per_million) : '',
                linuxdo_client_id: data.linuxdo_client_id || '',
                linuxdo_redirect_uri: data.linuxdo_redirect_uri || '',
                epay_pid: data.epay_pid || '',
                linuxdo_credits_per_cny: data.linuxdo_credits_per_cny != null ? String(data.linuxdo_credits_per_cny) : '',
            }));
        } catch (e) {
            console.error('Failed to fetch system settings:', e);
        } finally {
            setIsFetching(false);
        }
    };

    const handleSave = async () => {
        setIsLoading(true);
        setSuccess('');
        try {
            const payload: any = {};

            if (formData.claude_api_key) payload.claude_api_key = formData.claude_api_key;
            // Always send URL/model so admin can clear them
            payload.claude_api_base_url = formData.claude_api_base_url || null;
            payload.claude_model = formData.claude_model || null;

            if (formData.nanobanana_api_key) payload.nanobanana_api_key = formData.nanobanana_api_key;
            payload.nanobanana_api_base_url = formData.nanobanana_api_base_url || null;
            payload.nanobanana_model = formData.nanobanana_model || null;

            // LinuxDO OAuth
            payload.linuxdo_client_id = formData.linuxdo_client_id || null;
            if (formData.linuxdo_client_secret) payload.linuxdo_client_secret = formData.linuxdo_client_secret;
            payload.linuxdo_redirect_uri = formData.linuxdo_redirect_uri || null;

            // EasyPay (Linux DO Credits)
            payload.epay_pid = formData.epay_pid || null;
            if (formData.epay_key) payload.epay_key = formData.epay_key;
            if (formData.linuxdo_credits_per_cny !== '') payload.linuxdo_credits_per_cny = parseFloat(formData.linuxdo_credits_per_cny);

            if (formData.image_price_cny !== '') payload.image_price_cny = parseFloat(formData.image_price_cny);
            if (formData.image_price_cny_1k !== '') payload.image_price_cny_1k = parseFloat(formData.image_price_cny_1k);
            if (formData.image_price_cny_2k !== '') payload.image_price_cny_2k = parseFloat(formData.image_price_cny_2k);
            if (formData.image_price_cny_4k !== '') payload.image_price_cny_4k = parseFloat(formData.image_price_cny_4k);
            if (formData.usd_cny_rate !== '') payload.usd_cny_rate = parseFloat(formData.usd_cny_rate);
            if (formData.claude_input_usd_per_million !== '') payload.claude_input_usd_per_million = parseFloat(formData.claude_input_usd_per_million);
            if (formData.claude_output_usd_per_million !== '') payload.claude_output_usd_per_million = parseFloat(formData.claude_output_usd_per_million);

            const res = await api.put('/admin/settings', payload);
            setSettings(res.data);
            setSuccess('系统设置保存成功！');

            // Clear key fields after save
            setFormData(prev => ({ ...prev, claude_api_key: '', nanobanana_api_key: '', linuxdo_client_secret: '', epay_key: '' }));
        } catch (e) {
            console.error(e);
            alert('保存系统设置失败，请重试');
        } finally {
            setIsLoading(false);
        }
    };

    if (!user?.is_admin) {
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

    if (isFetching) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Shield className="w-7 h-7 text-primary" />
                    系统管理
                </h1>
                <p className="text-muted-foreground mt-1">管理系统级 API 密钥、请求地址和模型配置。这些设置为所有用户提供默认值。</p>
            </div>

            {/* Linux DO OAuth Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Globe className="w-5 h-5" />
                        Linux DO OAuth 配置
                    </CardTitle>
                    <CardDescription>配置 Linux DO OAuth 登录。配置完成后，登录页将自动切换为 Linux DO 登录按钮。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="linuxdo_client_id">Client ID</Label>
                        <Input
                            id="linuxdo_client_id"
                            placeholder="输入 Linux DO OAuth Client ID"
                            value={formData.linuxdo_client_id}
                            onChange={e => setFormData({ ...formData, linuxdo_client_id: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label htmlFor="linuxdo_client_secret">Client Secret</Label>
                            {settings.linuxdo_client_secret_set && (
                                <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                            )}
                        </div>
                        <Input
                            id="linuxdo_client_secret"
                            type="password"
                            placeholder={settings.linuxdo_client_secret_set ? "****** (已设置，留空保持不变)" : "输入 Linux DO OAuth Client Secret"}
                            value={formData.linuxdo_client_secret}
                            onChange={e => setFormData({ ...formData, linuxdo_client_secret: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="linuxdo_redirect_uri">回调地址（Redirect URI）</Label>
                        <Input
                            id="linuxdo_redirect_uri"
                            placeholder="https://fig.keepgo.de5.net/api/v1/auth/linuxdo/callback"
                            value={formData.linuxdo_redirect_uri}
                            onChange={e => setFormData({ ...formData, linuxdo_redirect_uri: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">此地址需与 Linux DO OAuth 应用中配置的回调地址一致。格式：https://你的域名/api/v1/auth/linuxdo/callback</p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                    <div>
                        {success && <p className="text-sm text-green-600 font-medium">{success}</p>}
                    </div>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存 OAuth 配置
                    </Button>
                </CardFooter>
            </Card>

            {/* Linux DO Credits Payment (EasyPay) */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Coins className="w-5 h-5" />
                        Linux DO 积分支付
                    </CardTitle>
                    <CardDescription>配置 EasyPay 积分支付，让用户可以使用 Linux DO 积分自助充值余额。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="epay_pid">EasyPay PID</Label>
                        <Input
                            id="epay_pid"
                            placeholder="输入 EasyPay 商户 PID"
                            value={formData.epay_pid}
                            onChange={e => setFormData({ ...formData, epay_pid: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label htmlFor="epay_key">EasyPay Key</Label>
                            {settings.epay_key_set && (
                                <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                            )}
                        </div>
                        <Input
                            id="epay_key"
                            type="password"
                            placeholder={settings.epay_key_set ? "****** (已设置，留空保持不变)" : "输入 EasyPay Key"}
                            value={formData.epay_key}
                            onChange={e => setFormData({ ...formData, epay_key: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="linuxdo_credits_per_cny">积分兑换比率</Label>
                        <Input
                            id="linuxdo_credits_per_cny"
                            type="number"
                            step="0.0001"
                            placeholder="1.0000"
                            value={formData.linuxdo_credits_per_cny}
                            onChange={e => setFormData({ ...formData, linuxdo_credits_per_cny: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">1 元 = X 积分。例如填 1.0000 表示 1 元需要 1 积分。</p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                    <div>
                        {success && <p className="text-sm text-green-600 font-medium">{success}</p>}
                    </div>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存积分支付配置
                    </Button>
                </CardFooter>
            </Card>

            {/* Claude API Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="w-5 h-5" />
                        Claude API 配置
                    </CardTitle>
                    <CardDescription>系统默认的 Claude API 密钥和请求地址。用户 BYOK 设置优先于此处配置。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label htmlFor="sys_claude_key">系统 Claude API Key</Label>
                            {settings.claude_api_key_set && (
                                <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                            )}
                        </div>
                        <Input
                            id="sys_claude_key"
                            type="password"
                            placeholder={settings.claude_api_key_set ? "sk-ant-**** (已设置)" : "sk-ant-..."}
                            value={formData.claude_api_key}
                            onChange={e => setFormData({ ...formData, claude_api_key: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sys_claude_url">Claude API 请求地址</Label>
                        <Input
                            id="sys_claude_url"
                            placeholder="https://api.anthropic.com （留空使用默认地址）"
                            value={formData.claude_api_base_url}
                            onChange={e => setFormData({ ...formData, claude_api_base_url: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">如果使用代理或中转服务，请填写完整的 API 基础地址。留空则使用 Anthropic 官方地址。</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sys_claude_model">Claude 模型名称</Label>
                        <Input
                            id="sys_claude_model"
                            placeholder="claude-sonnet-4-20250514 （留空使用默认模型）"
                            value={formData.claude_model}
                            onChange={e => setFormData({ ...formData, claude_model: e.target.value })}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* NanoBanana API Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="w-5 h-5" />
                        NanoBanana API 配置
                    </CardTitle>
                    <CardDescription>系统默认的配图服务 API 密钥和请求地址。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label htmlFor="sys_nb_key">系统 NanoBanana API Key</Label>
                            {settings.nanobanana_api_key_set && (
                                <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                            )}
                        </div>
                        <Input
                            id="sys_nb_key"
                            type="password"
                            placeholder={settings.nanobanana_api_key_set ? "sk-**** (已设置)" : "输入配图服务 API Key"}
                            value={formData.nanobanana_api_key}
                            onChange={e => setFormData({ ...formData, nanobanana_api_key: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sys_nb_url">NanoBanana API 请求地址</Label>
                        <Input
                            id="sys_nb_url"
                            placeholder="https://api.ikuncode.cc （留空使用默认地址）"
                            value={formData.nanobanana_api_base_url}
                            onChange={e => setFormData({ ...formData, nanobanana_api_base_url: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">如果使用代理或中转服务，请填写完整的 API 基础地址。</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sys_nb_model">NanoBanana 模型名称</Label>
                        <Input
                            id="sys_nb_model"
                            placeholder="gemini-3-pro-image-preview （留空使用默认）"
                            value={formData.nanobanana_model}
                            onChange={e => setFormData({ ...formData, nanobanana_model: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">用于拼接请求路径：`/v1beta/models/&lt;model&gt;:generateContent`。</p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                    <div>
                        {success && <p className="text-sm text-green-600 font-medium">{success}</p>}
                    </div>
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存系统设置
                    </Button>
                </CardFooter>
            </Card>

            {/* Pricing Settings */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="w-5 h-5" />
                        计费配置
                    </CardTitle>
                    <CardDescription>配置不同分辨率图片单价、汇率与 Claude Token 单价（按官网价格/每 100 万 Tokens）。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>图片单价（¥/张）</Label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="price_image_1k" className="text-xs text-muted-foreground">1K</Label>
                                <Input
                                    id="price_image_1k"
                                    type="number"
                                    step="0.01"
                                    placeholder="1.50"
                                    value={formData.image_price_cny_1k}
                                    onChange={e => setFormData({ ...formData, image_price_cny_1k: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="price_image_2k" className="text-xs text-muted-foreground">2K</Label>
                                <Input
                                    id="price_image_2k"
                                    type="number"
                                    step="0.01"
                                    placeholder="1.50"
                                    value={formData.image_price_cny_2k}
                                    onChange={e => setFormData({ ...formData, image_price_cny_2k: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="price_image_4k" className="text-xs text-muted-foreground">4K</Label>
                                <Input
                                    id="price_image_4k"
                                    type="number"
                                    step="0.01"
                                    placeholder="1.50"
                                    value={formData.image_price_cny_4k}
                                    onChange={e => setFormData({ ...formData, image_price_cny_4k: e.target.value })}
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">如果未填写，将回退到通用单价（兼容旧版本）。</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="price_fx">USD→CNY 汇率</Label>
                        <Input
                            id="price_fx"
                            type="number"
                            step="0.0001"
                            placeholder="7.2"
                            value={formData.usd_cny_rate}
                            onChange={e => setFormData({ ...formData, usd_cny_rate: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="price_claude_in">Claude 输入单价（USD / 1M）</Label>
                            <Input
                                id="price_claude_in"
                                type="number"
                                step="0.01"
                                placeholder="3"
                                value={formData.claude_input_usd_per_million}
                                onChange={e => setFormData({ ...formData, claude_input_usd_per_million: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="price_claude_out">Claude 输出单价（USD / 1M）</Label>
                            <Input
                                id="price_claude_out"
                                type="number"
                                step="0.01"
                                placeholder="15"
                                value={formData.claude_output_usd_per_million}
                                onChange={e => setFormData({ ...formData, claude_output_usd_per_million: e.target.value })}
                            />
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t bg-muted/40 p-4">
                    <Button onClick={handleSave} disabled={isLoading}>
                        {isLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存计费配置
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
