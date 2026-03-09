import { useEffect, useState } from 'react';
import { Download, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { ASPECT_RATIO_OPTIONS, RESOLUTION_OPTIONS } from '../lib/catalog';
import { saveImageToDownloads } from '../lib/runtime';
import { formatDate } from '../lib/utils';
import { imageService } from '../services/imageService';
import { useSettingsStore } from '../store/settingsStore';
import type { AspectRatio, ImageRecord, Resolution } from '../types/models';

export function Generate() {
  const settings = useSettingsStore((state) => state.publicSettings);
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState<Resolution>(settings?.defaultResolution ?? '2K');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(settings?.defaultAspectRatio ?? '4:3');
  const [referenceImage, setReferenceImage] = useState<File | undefined>();
  const [editInstruction, setEditInstruction] = useState('');
  const [history, setHistory] = useState<ImageRecord[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const loadHistory = async () => setHistory(await imageService.listImages());
  useEffect(() => { void loadHistory(); }, []);

  const handleGenerate = async () => {
    setError('');
    setSuccess('');
    if (!prompt.trim()) return setError('请输入用于生成图片的 Prompt');
    setIsBusy(true);
    try {
      await imageService.generateImage({
        promptText: prompt.trim(),
        resolution,
        aspectRatio,
        referenceImage,
        editInstruction: editInstruction.trim() || undefined,
        colorSchemeId: settings?.defaultColorScheme ?? 'okabe-ito',
      });
      setPrompt('');
      setEditInstruction('');
      setReferenceImage(undefined);
      await loadHistory();
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '直接生成失败');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownload = async (image: ImageRecord) => {
    if (!image.previewDataUrl) return;
    setError('');
    setSuccess('');
    try {
      const savedPath = await saveImageToDownloads(`direct-generate-${image.id}.png`, image.previewDataUrl);
      setSuccess(savedPath ? `图片已下载到：${savedPath}` : '图片下载已触发，请查看系统默认下载目录');
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '图片下载失败');
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
        <CardHeader><CardTitle>直接生成</CardTitle><CardDescription>不绑定任何项目，适合快速试 Prompt、做样式探索或临时图生图编辑。</CardDescription></CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-4">
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}
            <div className="space-y-2"><Label htmlFor="direct-prompt">Prompt</Label><Textarea id="direct-prompt" rows={10} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>分辨率</Label><Select value={resolution} onValueChange={(value) => setResolution(value as Resolution)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RESOLUTION_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>宽高比</Label><Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECT_RATIO_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="direct-ref">参考图（可选）</Label><Input id="direct-ref" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setReferenceImage(event.target.files?.[0])} /></div>
            <div className="space-y-2"><Label htmlFor="edit-instruction">图生图编辑指令（可选）</Label><Textarea id="edit-instruction" rows={4} value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} /></div>
            <Button onClick={() => void handleGenerate()} disabled={isBusy}><Sparkles className="mr-2 h-4 w-4" />{isBusy ? '生成中...' : '开始生成'}</Button>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
            <div className="text-sm font-medium text-slate-900">使用建议</div>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
              <li>1. 先用 1K 或 2K 快速试风格，确认结构再切 4K。</li>
              <li>2. Prompt 里尽量明确画布比例、阅读方向、字体、箭头和图例位置。</li>
              <li>3. 如果要改已有图片，参考图和编辑指令一起给，结果会更稳定。</li>
            </ul>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {history.map((image) => (
          <Card key={image.id} className="overflow-hidden rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
            {image.previewDataUrl ? <img src={image.previewDataUrl} alt={image.id} className="aspect-[4/3] w-full object-cover" /> : null}
            <CardContent className="space-y-4 p-5">
              <div className="text-xs text-slate-500">{image.resolution} · {image.aspectRatio} · {formatDate(image.createdAt)}</div>
              <p className="text-sm leading-6 text-slate-600">{(image.finalPromptSent ?? '').slice(0, 140)}{(image.finalPromptSent ?? '').length > 140 ? '...' : ''}</p>
              {image.previewDataUrl ? <Button variant="outline" onClick={() => void handleDownload(image)}><Download className="mr-2 h-4 w-4" />下载</Button> : null}
            </CardContent>
          </Card>
        ))}
        {history.length === 0 ? <Card className="rounded-[28px] border-white/70 bg-white/80 p-8 shadow-xl shadow-slate-200/50 md:col-span-2 xl:col-span-3"><CardTitle className="text-lg">直接生成历史为空</CardTitle><CardDescription className="mt-2">这里会显示未绑定到项目的图片历史。</CardDescription></Card> : null}
      </div>
    </div>
  );
}
