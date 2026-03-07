import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LockKeyhole, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { useSettingsStore } from '../store/settingsStore';

export function Setup() {
  const navigate = useNavigate();
  const { publicSettings, secureSettings, saveSetup } = useSettingsStore();
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeBaseUrl, setClaudeBaseUrl] = useState('https://api.anthropic.com');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-20250514');
  const [nanobananaApiKey, setNanobananaApiKey] = useState('');
  const [nanobananaBaseUrl, setNanobananaBaseUrl] = useState('https://api.keepgo.icu');
  const [ocrServerUrl, setOcrServerUrl] = useState('');
  const [ocrToken, setOcrToken] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!secureSettings) return;
    setClaudeApiKey(secureSettings.claudeApiKey);
    setClaudeBaseUrl(secureSettings.claudeBaseUrl);
    setClaudeModel(secureSettings.claudeModel);
    setNanobananaApiKey(secureSettings.nanobananaApiKey);
    setNanobananaBaseUrl(secureSettings.nanobananaBaseUrl);
    setOcrServerUrl(secureSettings.ocrServerUrl);
    setOcrToken(secureSettings.ocrToken);
  }, [secureSettings]);

  const handleSubmit = async () => {
    setError('');
    setIsSaving(true);
    try {
      await saveSetup({
        publicSettings: {
          defaultColorScheme: publicSettings?.defaultColorScheme ?? 'okabe-ito',
          defaultResolution: publicSettings?.defaultResolution ?? '2K',
          defaultAspectRatio: publicSettings?.defaultAspectRatio ?? '4:3',
        },
        secureSettings: {
          claudeApiKey: claudeApiKey.trim(),
          claudeBaseUrl: claudeBaseUrl.trim(),
          claudeModel: claudeModel.trim(),
          nanobananaApiKey: nanobananaApiKey.trim(),
          nanobananaBaseUrl: nanobananaBaseUrl.trim(),
          ocrServerUrl: ocrServerUrl.trim(),
          ocrToken: ocrToken.trim(),
        },
      });
      navigate('/projects', { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '初始化配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(12,74,110,0.14),_transparent_32%),linear-gradient(180deg,_#f7f2e8_0%,_#ffffff_40%,_#f8fafc_100%)] px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-700 shadow-sm">
            <Sparkles className="h-4 w-4 text-sky-700" />
            Academic Figure Generator Desktop
          </div>
          <div className="space-y-4">
            <h1 className="max-w-2xl text-5xl font-semibold tracking-tight text-slate-900">把 Web 版能力收进本地桌面应用</h1>
            <p className="max-w-xl text-lg leading-8 text-slate-600">可以直接进入桌面端开始管理项目。Claude、NanoBanana 和 OCR 凭证都可以稍后再到设置页补充。</p>
          </div>
        </div>

        <Card className="border-slate-200/90 bg-white/90 shadow-xl shadow-slate-200/70 backdrop-blur">
          <CardHeader>
            <CardTitle>可选初始化设置</CardTitle>
            <CardDescription>这些配置都不是必填项。保存后将直接进入项目列表，后续可随时在设置页修改。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <section className="space-y-4">
              <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-sky-700" /><h2 className="font-medium text-slate-900">Claude 配置</h2></div>
              <div className="grid gap-4">
                <div className="space-y-2"><Label htmlFor="claude-key">Claude API Key</Label><Input id="claude-key" value={claudeApiKey} onChange={(event) => setClaudeApiKey(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="claude-base-url">Claude Base URL</Label><Input id="claude-base-url" value={claudeBaseUrl} onChange={(event) => setClaudeBaseUrl(event.target.value)} /></div>
                <div className="space-y-2">
                  <Label>Claude 模型</Label>
                  <Select value={claudeModel} onValueChange={setClaudeModel}>
                    <SelectTrigger><SelectValue placeholder="选择 Claude 模型" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</SelectItem>
                      <SelectItem value="claude-opus-4-1-20250805">claude-opus-4-1-20250805</SelectItem>
                      <SelectItem value="claude-sonnet-4-5-20250929">claude-sonnet-4-5-20250929</SelectItem>
                      <SelectItem value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-sky-700" /><h2 className="font-medium text-slate-900">NanoBanana 配置</h2></div>
              <div className="grid gap-4">
                <div className="space-y-2"><Label htmlFor="nanobanana-key">NanoBanana API Key</Label><Input id="nanobanana-key" value={nanobananaApiKey} onChange={(event) => setNanobananaApiKey(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="nanobanana-base-url">NanoBanana Base URL</Label><Input id="nanobanana-base-url" value={nanobananaBaseUrl} onChange={(event) => setNanobananaBaseUrl(event.target.value)} /></div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="font-medium text-slate-900">OCR 配置（可选）</h2>
              <div className="grid gap-4">
                <div className="space-y-2"><Label htmlFor="ocr-url">PaddleOCR Server URL</Label><Input id="ocr-url" value={ocrServerUrl} onChange={(event) => setOcrServerUrl(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="ocr-token">PaddleOCR Token</Label><Textarea id="ocr-token" value={ocrToken} onChange={(event) => setOcrToken(event.target.value)} rows={3} /></div>
              </div>
            </section>

            <Button className="w-full" size="lg" onClick={() => void handleSubmit()} disabled={isSaving}>{isSaving ? '保存中...' : '进入桌面端'}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
