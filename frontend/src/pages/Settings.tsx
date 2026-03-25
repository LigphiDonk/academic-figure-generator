import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { PromptAIModelField, type PromptAIModelOption } from '../components/PromptAIModelField';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { RefreshCw, CheckCircle2, Lock, ScanText } from 'lucide-react';

type PromptAIProvider = 'anthropic' | 'openai-compatible';

export function Settings() {
    const { user, updateUser } = useAuthStore();
    const [isLoading, setIsLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [isFetchingPromptAiModels, setIsFetchingPromptAiModels] = useState(false);
    const [promptAiModels, setPromptAiModels] = useState<PromptAIModelOption[]>([]);
    const [promptAiModelsMessage, setPromptAiModelsMessage] = useState('');
    const [promptAiModelsError, setPromptAiModelsError] = useState('');
    const [isFetchingNanoBananaModels, setIsFetchingNanoBananaModels] = useState(false);
    const [nanoBananaModels, setNanoBananaModels] = useState<PromptAIModelOption[]>([]);
    const [nanoBananaModelsMessage, setNanoBananaModelsMessage] = useState('');
    const [nanoBananaModelsError, setNanoBananaModelsError] = useState('');

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
        prompt_ai_provider: user?.prompt_ai_provider || 'anthropic',
        prompt_ai_api_key: '',
        prompt_ai_model: user?.prompt_ai_model || '',
        nanobanana_api_key: '',
        nanobanana_model: user?.nanobanana_model || '',
        paddleocr_api_key: '',
        prompt_ai_api_base_url: user?.prompt_ai_api_base_url || '',
        nanobanana_api_base_url: user?.nanobanana_api_base_url || '',
        paddleocr_server_url: user?.paddleocr_server_url || '',
    });

    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrSuccess, setOcrSuccess] = useState('');
    const [ocrError, setOcrError] = useState('');

    useEffect(() => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                display_name: user.display_name,
                prompt_ai_provider: user.prompt_ai_provider || 'anthropic',
                prompt_ai_model: user.prompt_ai_model || '',
                nanobanana_model: user.nanobanana_model || '',
                prompt_ai_api_base_url: user.prompt_ai_api_base_url || '',
                nanobanana_api_base_url: user.nanobanana_api_base_url || '',
                paddleocr_server_url: user.paddleocr_server_url || '',
            }));
        }
    }, [user]);

    useEffect(() => {
        setPromptAiModels([]);
        setPromptAiModelsMessage('');
        setPromptAiModelsError('');
    }, [formData.prompt_ai_provider, formData.prompt_ai_api_base_url, formData.prompt_ai_api_key]);

    useEffect(() => {
        setNanoBananaModels([]);
        setNanoBananaModelsMessage('');
        setNanoBananaModelsError('');
    }, [formData.nanobanana_api_base_url, formData.nanobanana_api_key]);

    const handleSave = async () => {
        setIsLoading(true);
        setSuccess('');
        try {
            const payload: any = {
                display_name: formData.display_name,
                prompt_ai_provider: formData.prompt_ai_provider,
                prompt_ai_api_base_url: formData.prompt_ai_api_base_url || null,
                prompt_ai_model: formData.prompt_ai_model || null,
                nanobanana_api_base_url: formData.nanobanana_api_base_url || null,
                nanobanana_model: formData.nanobanana_model || null,
            };

            if (formData.prompt_ai_api_key) payload.prompt_ai_api_key = formData.prompt_ai_api_key;
            if (formData.nanobanana_api_key) payload.nanobanana_api_key = formData.nanobanana_api_key;

            const res = await api.put('/auth/me', payload);
            updateUser(res.data);
            setSuccess('设置保存成功！');

            // Clear api keys from form data after save
            setFormData(prev => ({ ...prev, prompt_ai_api_key: '', nanobanana_api_key: '' }));
            setOcrSuccess('');
            setOcrError('');
        } catch (e) {
            console.error(e);
            alert('保存设置失败，请重试');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveOcr = async () => {
        setOcrLoading(true);
        setOcrSuccess('');
        setOcrError('');
        try {
            const payload: any = {
                paddleocr_server_url: formData.paddleocr_server_url || null,
            };
            if (formData.paddleocr_api_key) payload.paddleocr_api_key = formData.paddleocr_api_key;
            const res = await api.put('/auth/me', payload);
            updateUser(res.data);
            setOcrSuccess('PaddleOCR 配置保存成功！');
            setFormData(prev => ({ ...prev, paddleocr_api_key: '' }));
        } catch (e) {
            setOcrError('保存失败，请重试');
        } finally {
            setOcrLoading(false);
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

    const handleFetchPromptAiModels = async () => {
        setIsFetchingPromptAiModels(true);
        setPromptAiModels([]);
        setPromptAiModelsMessage('');
        setPromptAiModelsError('');
        try {
            const res = await api.post('/auth/me/prompt-ai/models', {
                prompt_ai_provider: formData.prompt_ai_provider,
                prompt_ai_api_key: formData.prompt_ai_api_key || null,
                prompt_ai_api_base_url: formData.prompt_ai_api_base_url || null,
            });
            const models: PromptAIModelOption[] = Array.isArray(res.data?.models) ? res.data.models : [];
            setPromptAiModels(models);
            setPromptAiModelsMessage(
                models.length > 0
                    ? `已拉取 ${models.length} 个模型，可直接选择，也可以继续手动输入。`
                    : '当前配置未返回可用模型，仍可手动输入模型名称。'
            );
        } catch (err: any) {
            setPromptAiModelsError(err.response?.data?.detail || '拉取模型失败，请检查 Provider、API Key 和请求地址。');
        } finally {
            setIsFetchingPromptAiModels(false);
        }
    };

    const handleFetchNanoBananaModels = async () => {
        setIsFetchingNanoBananaModels(true);
        setNanoBananaModels([]);
        setNanoBananaModelsMessage('');
        setNanoBananaModelsError('');
        try {
            const res = await api.post('/auth/me/nanobanana/models', {
                nanobanana_api_key: formData.nanobanana_api_key || null,
                nanobanana_api_base_url: formData.nanobanana_api_base_url || null,
            });
            const models: PromptAIModelOption[] = Array.isArray(res.data?.models) ? res.data.models : [];
            setNanoBananaModels(models);
            setNanoBananaModelsMessage(
                models.length > 0
                    ? `已拉取 ${models.length} 个模型，可直接选择，也可以继续手动输入。`
                    : '当前配置未返回可用模型，仍可手动输入模型名称。'
            );
        } catch (err: any) {
            setNanoBananaModelsError(err.response?.data?.detail || '拉取模型失败，请检查 API Key 和请求地址。');
        } finally {
            setIsFetchingNanoBananaModels(false);
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
                    <CardDescription>绑定您自己的提示词生成 AI 配置和配图服务配置，优先使用自有设置。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Prompt AI Section */}
                    <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-foreground">提示词生成 AI</h4>
                        <div className="space-y-2">
                            <Label>服务商</Label>
                            <Select
                                value={formData.prompt_ai_provider}
                                onValueChange={value => setFormData({ ...formData, prompt_ai_provider: value as PromptAIProvider })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择服务商" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="anthropic">Anthropic</SelectItem>
                                    <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="prompt_ai_api_key">API Key</Label>
                                {user.prompt_ai_api_key_set && (
                                    <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3 mr-1" /> 已配置</span>
                                )}
                            </div>
                            <Input
                                id="prompt_ai_api_key"
                                type="password"
                                placeholder={user.prompt_ai_api_key_set ? "****** (已配置，输入新值以覆盖)" : formData.prompt_ai_provider === 'anthropic' ? "sk-ant-..." : "sk-..."}
                                value={formData.prompt_ai_api_key}
                                onChange={e => setFormData({ ...formData, prompt_ai_api_key: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="prompt_ai_url">请求地址</Label>
                            <Input
                                id="prompt_ai_url"
                                placeholder={formData.prompt_ai_provider === 'anthropic' ? "https://api.anthropic.com （留空使用系统默认）" : "https://api.openai.com （留空使用系统默认）"}
                                value={formData.prompt_ai_api_base_url}
                                onChange={e => setFormData({ ...formData, prompt_ai_api_base_url: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">如使用中转服务，请填写 API 基础地址，不要包含最终接口路径。</p>
                        </div>
                        <div className="space-y-2">
                            <PromptAIModelField
                                id="prompt_ai_model"
                                label="模型名称"
                                placeholder={formData.prompt_ai_provider === 'anthropic' ? "claude-sonnet-4-20250514" : "gpt-4.1-mini"}
                                value={formData.prompt_ai_model}
                                onChange={value => setFormData({ ...formData, prompt_ai_model: value })}
                                onFetch={handleFetchPromptAiModels}
                                isFetching={isFetchingPromptAiModels}
                                models={promptAiModels}
                                fetchHint="点击“拉取模型”会优先使用当前表单中的配置；若 API Key 留空，则回退到已保存的 BYOK 或系统默认配置。"
                                message={promptAiModelsMessage}
                                error={promptAiModelsError}
                            />
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
                        <div className="space-y-2">
                            <PromptAIModelField
                                id="nanobanana_model"
                                label="模型名称"
                                placeholder="gemini-3-pro-image-preview"
                                value={formData.nanobanana_model}
                                onChange={value => setFormData({ ...formData, nanobanana_model: value })}
                                onFetch={handleFetchNanoBananaModels}
                                isFetching={isFetchingNanoBananaModels}
                                models={nanoBananaModels}
                                fetchHint="点击“拉取模型”会优先使用当前表单中的配置；若 API Key 留空，则回退到已保存的 BYOK 或系统默认配置。"
                                message={nanoBananaModelsMessage}
                                error={nanoBananaModelsError}
                            />
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

            {/* PaddleOCR Configuration Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ScanText className="w-5 h-5 text-blue-500" />
                        PaddleOCR 文档解析
                    </CardTitle>
                    <CardDescription>
                        配置您自己的 PaddleOCR-VL 服务地址和访问令牌，用于将 PDF 解析为结构化 Markdown。
                        配置后可在项目工作区对 PDF 文档一键触发 OCR 解析。
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="rounded-lg border bg-blue-50/50 p-3 text-xs text-blue-700 space-y-1">
                        <p className="font-medium">如何获取？</p>
                        <p>在 AI Studio 部署 PaddleOCR-VL 后，将服务地址（形如 <code className="font-mono bg-blue-100 px-1 rounded">https://xxx.aistudio-app.com</code>）和 Access Token 填入下方。</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="paddleocr_url">Server URL</Label>
                        <Input
                            id="paddleocr_url"
                            placeholder="https://your-app.aistudio-app.com"
                            value={formData.paddleocr_server_url}
                            onChange={e => setFormData({ ...formData, paddleocr_server_url: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">可填写服务根地址，也可直接填写完整的 <code className="font-mono">/layout-parsing</code> 接口地址。</p>
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <Label htmlFor="paddleocr_token">Access Token</Label>
                            {user.paddleocr_api_key_set && (
                                <span className="flex items-center text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> 已配置
                                </span>
                            )}
                        </div>
                        <Input
                            id="paddleocr_token"
                            type="password"
                            placeholder={(user as any).paddleocr_api_key_set ? "（已配置，输入新值以覆盖）" : "输入 Access Token"}
                            value={formData.paddleocr_api_key}
                            onChange={e => setFormData({ ...formData, paddleocr_api_key: e.target.value })}
                        />
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t bg-muted/40 p-4">
                    <div>
                        {ocrSuccess && <p className="text-sm text-green-600 font-medium">{ocrSuccess}</p>}
                        {ocrError && <p className="text-sm text-red-600 font-medium">{ocrError}</p>}
                    </div>
                    <Button onClick={handleSaveOcr} disabled={ocrLoading}>
                        {ocrLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        保存 OCR 配置
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
