import { useState } from 'react';
import { Database, FolderArchive, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { ASPECT_RATIO_OPTIONS, RESOLUTION_OPTIONS } from '../lib/catalog';
import { resetAllData } from '../services/storage';
import { useProjectStore } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AspectRatio, Resolution } from '../types/models';

export function Settings() {
  const { publicSettings, secureSettings, appPaths, savePublicSettings, saveSecureSettings, refresh } = useSettingsStore();
  const refreshProjects = useProjectStore((state) => state.refreshProjects);
  const [claudeApiKey, setClaudeApiKey] = useState(() => secureSettings?.claudeApiKey ?? '');
  const [claudeBaseUrl, setClaudeBaseUrl] = useState(() => secureSettings?.claudeBaseUrl ?? 'https://api.anthropic.com');
  const [claudeModel, setClaudeModel] = useState(() => secureSettings?.claudeModel ?? 'claude-sonnet-4-20250514');
  const [nanobananaApiKey, setNanobananaApiKey] = useState(() => secureSettings?.nanobananaApiKey ?? '');
  const [nanobananaBaseUrl, setNanobananaBaseUrl] = useState(() => secureSettings?.nanobananaBaseUrl ?? 'https://api.keepgo.icu');
  const [nanobananaModel, setNanobananaModel] = useState(() => secureSettings?.nanobananaModel ?? 'gemini-2.0-flash-exp-image-generation');
  const [ocrServerUrl, setOcrServerUrl] = useState(() => secureSettings?.ocrServerUrl ?? '');
  const [ocrToken, setOcrToken] = useState(() => secureSettings?.ocrToken ?? '');
  const [defaultResolution, setDefaultResolution] = useState<Resolution>(() => publicSettings?.defaultResolution ?? '2K');
  const [defaultAspectRatio, setDefaultAspectRatio] = useState<AspectRatio>(() => publicSettings?.defaultAspectRatio ?? '4:3');
  const [defaultColorScheme, setDefaultColorScheme] = useState(() => publicSettings?.defaultColorScheme ?? 'okabe-ito');
  const [message, setMessage] = useState('');

  const handleSave = async () => {
    await saveSecureSettings({ claudeApiKey, claudeBaseUrl, claudeModel, nanobananaApiKey, nanobananaBaseUrl, nanobananaModel, ocrServerUrl, ocrToken });
    await savePublicSettings({ defaultResolution, defaultAspectRatio, defaultColorScheme });
    setMessage('设置已保存');
  };

  const handleClearCache = async () => {
    if (!window.confirm('清除本地缓存会移除项目、文档、提示词、图片历史，但保留 API 凭证。是否继续？')) return;
    await resetAllData(true);
    await refresh();
    await refreshProjects();
    setMessage('本地缓存已清除');
  };

  return (
    <div className="space-y-6">
      <div><div className="text-xs uppercase tracking-[0.24em] text-slate-400">Settings</div><h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">设置</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">这里管理 API 凭证、默认生成偏好，以及本地数据目录说明。</p></div>
      {message ? <Alert><AlertDescription>{message}</AlertDescription></Alert> : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />API 配置</CardTitle><CardDescription>桌面端默认优先使用用户自己的 Claude / NanoBanana / OCR 配置。</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="claude-key">Claude API Key</Label><Input id="claude-key" value={claudeApiKey} onChange={(event) => setClaudeApiKey(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="claude-url">Claude Base URL</Label><Input id="claude-url" value={claudeBaseUrl} onChange={(event) => setClaudeBaseUrl(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="claude-model">Claude 模型</Label><Input id="claude-model" value={claudeModel} onChange={(event) => setClaudeModel(event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="nano-key">NanoBanana API Key</Label><Input id="nano-key" value={nanobananaApiKey} onChange={(event) => setNanobananaApiKey(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="nano-url">NanoBanana Base URL</Label><Input id="nano-url" value={nanobananaBaseUrl} onChange={(event) => setNanobananaBaseUrl(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="nano-model">NanoBanana 模型</Label><Input id="nano-model" value={nanobananaModel} onChange={(event) => setNanobananaModel(event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="ocr-url">PaddleOCR Server URL</Label><Input id="ocr-url" value={ocrServerUrl} onChange={(event) => setOcrServerUrl(event.target.value)} /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="ocr-token">PaddleOCR Token</Label><Textarea id="ocr-token" rows={4} value={ocrToken} onChange={(event) => setOcrToken(event.target.value)} /></div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
            <CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" />默认偏好</CardTitle><CardDescription>新项目与直接生成会默认使用这些参数。</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>默认配色方案 ID</Label><Input value={defaultColorScheme} onChange={(event) => setDefaultColorScheme(event.target.value)} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>默认分辨率</Label><Select value={defaultResolution} onValueChange={(value) => setDefaultResolution(value as Resolution)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RESOLUTION_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>默认宽高比</Label><Select value={defaultAspectRatio} onValueChange={(value) => setDefaultAspectRatio(value as AspectRatio)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECT_RATIO_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <Button onClick={() => void handleSave()}>保存设置</Button>
            </CardContent>
          </Card>
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
            <CardHeader><CardTitle className="flex items-center gap-2"><FolderArchive className="h-4 w-4" />数据管理</CardTitle><CardDescription>桌面端会优先显示运行时返回的真实 App Data 路径；浏览器模式则回退到本地预览路径。</CardDescription></CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div>模式：{appPaths?.mode ?? 'browser'}</div>
                <div>App Data：{appPaths?.appDataDir ?? '--'}</div>
                <div>Documents：{appPaths?.documentsDir ?? '--'}</div>
                <div>Images：{appPaths?.imagesDir ?? '--'}</div>
              </div>
              <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => void handleClearCache()}>清除本地缓存</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
