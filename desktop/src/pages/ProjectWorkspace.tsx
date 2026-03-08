import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Download, FileUp, ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { ASPECT_RATIO_OPTIONS, FIGURE_TYPE_OPTIONS, RESOLUTION_OPTIONS } from '../lib/catalog';
import { formatDate, formatFileSize } from '../lib/utils';
import { colorSchemeService } from '../services/colorSchemeService';
import { documentService } from '../services/documentService';
import { imageService } from '../services/imageService';
import { promptService } from '../services/promptService';
import { useProjectStore } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AspectRatio, ColorScheme, DocumentRecord, FigureType, ImageRecord, PromptRecord, Resolution } from '../types/models';

// Per-prompt settings (color scheme, resolution, aspect ratio)
interface PromptSettings {
  colorScheme: string;
  resolution: Resolution;
  aspectRatio: AspectRatio;
}

export function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? '';
  const { currentProject, openProject, refreshProjects } = useProjectStore();
  const settings = useSettingsStore((state) => state.publicSettings);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [colorSchemes, setColorSchemes] = useState<ColorScheme[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // Document & page range state
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [pageRangeStart, setPageRangeStart] = useState(0);
  const [pageRangeEnd, setPageRangeEnd] = useState(0);

  // Prompt generation state
  const [figureTypes, setFigureTypes] = useState<FigureType[]>(['overall_framework']);
  const [customRequest, setCustomRequest] = useState('');
  const [maxCount, setMaxCount] = useState('3');
  const [templateMode, setTemplateMode] = useState(false);

  // Per-prompt settings
  const [promptSettings, setPromptSettings] = useState<Record<string, PromptSettings>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  const loadWorkspace = async () => {
    if (!projectId) return;
    const [project, nextDocuments, nextPrompts, nextImages, nextColorSchemes] = await Promise.all([
      openProject(projectId),
      documentService.listDocuments(projectId),
      promptService.listPrompts(projectId),
      imageService.listImages(projectId),
      colorSchemeService.listColorSchemes(),
    ]);
    if (!project) {
      setError('项目不存在或已被删除');
      return;
    }
    setDocuments(nextDocuments);
    setPrompts(nextPrompts);
    setImages(nextImages);
    setColorSchemes(nextColorSchemes);
    setPromptDrafts(Object.fromEntries(nextPrompts.map((item) => [item.id, item.editedPrompt ?? item.originalPrompt ?? ''])));
    if (!selectedDocumentId && nextDocuments[0]) setSelectedDocumentId(nextDocuments[0].id);
  };

  useEffect(() => {
    void loadWorkspace();
  }, [projectId]);

  const currentDocument = useMemo(
    () => documents.find((item) => item.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  // Initialize page range when document changes
  useEffect(() => {
    if (currentDocument) {
      const totalPages = currentDocument.pageTexts?.length ?? currentDocument.pageCount ?? 1;
      setPageRangeStart(0);
      setPageRangeEnd(Math.max(0, totalPages - 1));
    }
  }, [currentDocument]);

  // Get the total number of pages for the current document
  const totalPages = useMemo(
    () => currentDocument?.pageTexts?.length ?? currentDocument?.pageCount ?? 1,
    [currentDocument],
  );

  // Get full text preview grouped by page
  const pageContents = useMemo(() => {
    if (!currentDocument) return [];
    if (currentDocument.pageTexts?.length) {
      return currentDocument.pageTexts.map((text, i) => ({
        pageNumber: i + 1,
        text: text || '（空白页）',
      }));
    }
    // Fallback: show the entire parsed text as a single page
    if (currentDocument.parsedText) {
      return [{ pageNumber: 1, text: currentDocument.parsedText }];
    }
    return [];
  }, [currentDocument]);

  // Per-prompt settings helpers
  const getSettings = (promptId: string): PromptSettings => {
    if (promptSettings[promptId]) return promptSettings[promptId];
    const prompt = prompts.find((p) => p.id === promptId);
    return {
      resolution: settings?.defaultResolution ?? '2K',
      aspectRatio: prompt?.suggestedAspectRatio ?? settings?.defaultAspectRatio ?? '4:3',
      colorScheme: settings?.defaultColorScheme ?? 'okabe-ito',
    };
  };

  const updateSetting = (promptId: string, field: keyof PromptSettings, value: string) => {
    setPromptSettings((prev) => ({
      ...prev,
      [promptId]: {
        ...(prev[promptId] || getSettings(promptId)),
        [field]: value,
      },
    }));
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList?.length || !projectId) return;
    setError('');
    setSuccess('');
    setIsBusy(true);
    try {
      await documentService.uploadDocuments(projectId, Array.from(fileList));
      await loadWorkspace();
      await refreshProjects();
      setSuccess('文档已导入到本地项目');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '文档上传失败');
    } finally {
      event.target.value = '';
      setIsBusy(false);
    }
  };

  const handleGeneratePrompts = async () => {
    if (!projectId) return;
    setError('');
    setSuccess('');
    setIsBusy(true);
    try {
      await promptService.generatePrompts({
        projectId,
        documentId: selectedDocumentId || undefined,
        pageRange: currentDocument ? [pageRangeStart, pageRangeEnd] : undefined,
        figureTypes,
        customRequest: customRequest.trim() || undefined,
        maxCount: Math.min(Math.max(Number(maxCount) || 1, 1), 10),
        templateMode,
      });
      await loadWorkspace();
      await refreshProjects();
      setSuccess(templateMode ? '模板草案已生成' : 'Claude 提示词已生成');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '提示词生成失败');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSavePrompt = async (promptId: string) => {
    setError('');
    setSuccess('');
    try {
      await promptService.updatePrompt(promptId, promptDrafts[promptId] ?? '');
      await loadWorkspace();
      setSuccess('提示词已保存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '提示词保存失败');
    }
  };

  const handleGenerateImage = async (promptId: string) => {
    if (!projectId || !currentProject) return setError('请先选择要生成图片的提示词');
    const s = getSettings(promptId);
    setError('');
    setSuccess('');
    setIsBusy(true);
    try {
      await imageService.generateFromPrompt({
        projectId,
        promptId,
        resolution: s.resolution,
        aspectRatio: s.aspectRatio,
        colorSchemeId: s.colorScheme,
      });
      await loadWorkspace();
      await refreshProjects();
      setSuccess('图片已生成并保存在本地历史中');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '图片生成失败');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Workspace</div>
            <h1 className="text-3xl font-semibold text-slate-950">{currentProject?.name ?? '加载中...'}</h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-600">{currentProject?.description || '这个项目还没有描述。你可以先上传文档，再根据页码范围生成提示词和配图。'}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>文档</CardDescription><CardTitle>{documents.length}</CardTitle></CardHeader></Card>
            <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>Prompts</CardDescription><CardTitle>{prompts.length}</CardTitle></CardHeader></Card>
            <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>图片</CardDescription><CardTitle>{images.length}</CardTitle></CardHeader></Card>
          </div>
        </div>
      </section>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {success ? <Alert><AlertDescription>{success}</AlertDescription></Alert> : null}

      {/* Two-column layout */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        {/* LEFT COLUMN: Document + Generation controls */}
        <div className="space-y-5">
          {/* Document upload */}
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardHeader>
              <CardTitle>导入论文文档</CardTitle>
              <CardDescription>支持 PDF / DOCX / TXT，桌面应用会直接解析正文。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label htmlFor="document-upload" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                <FileUp className="h-4 w-4" />选择一个或多个文档
              </Label>
              <Input id="document-upload" type="file" accept=".pdf,.docx,.txt" multiple className="hidden" onChange={handleUpload} />

              {/* Document list */}
              <div className="space-y-2">
                {documents.map((document) => (
                  <button key={document.id} type="button" onClick={() => setSelectedDocumentId(document.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedDocumentId === document.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'}`}>
                    <div className="font-medium text-sm">{document.filename}</div>
                    <div className={`mt-1 text-xs ${selectedDocumentId === document.id ? 'text-slate-300' : 'text-slate-500'}`}>{formatFileSize(document.fileSizeBytes)} · {document.pageCount ?? '?'} 页 · {formatDate(document.createdAt)}</div>
                  </button>
                ))}
                {documents.length === 0 ? <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">还没有导入文档。</div> : null}
              </div>
            </CardContent>
          </Card>

          {/* Full text preview + page range */}
          {currentDocument && pageContents.length > 0 ? (
            <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
              <CardHeader>
                <CardTitle className="text-lg">文档预览 — {currentDocument.filename}</CardTitle>
                <CardDescription>{totalPages} 页 · {currentDocument.wordCount ?? 0} 词 · 选中第 {pageRangeStart + 1} – {pageRangeEnd + 1} 页作为上下文</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Page range sliders */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-500">起始页：第 {pageRangeStart + 1} 页</Label>
                    <input
                      type="range"
                      min={0}
                      max={totalPages - 1}
                      value={pageRangeStart}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setPageRangeStart(v);
                        if (v > pageRangeEnd) setPageRangeEnd(v);
                      }}
                      className="w-full accent-slate-900"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-500">结束页：第 {pageRangeEnd + 1} 页</Label>
                    <input
                      type="range"
                      min={0}
                      max={totalPages - 1}
                      value={pageRangeEnd}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setPageRangeEnd(v);
                        if (v < pageRangeStart) setPageRangeStart(v);
                      }}
                      className="w-full accent-slate-900"
                    />
                  </div>
                </div>

                {/* Scrollable full text preview */}
                <div className="max-h-[420px] overflow-y-auto space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  {pageContents.map((page) => {
                    const isInRange = page.pageNumber - 1 >= pageRangeStart && page.pageNumber - 1 <= pageRangeEnd;
                    return (
                      <div
                        key={page.pageNumber}
                        className={`rounded-xl p-3 transition-colors ${isInRange ? 'bg-white border border-slate-300 shadow-sm' : 'bg-slate-100/60 opacity-50'}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={isInRange ? 'default' : 'outline'} className="text-xs">第 {page.pageNumber} 页</Badge>
                        </div>
                        <p className="text-xs leading-6 text-slate-700 whitespace-pre-wrap break-words">{page.text.slice(0, 600)}{page.text.length > 600 ? '...' : ''}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Prompt generation controls */}
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardHeader>
              <CardTitle>生成学术配图提示词</CardTitle>
              <CardDescription>基于选中的页码范围调用 Claude 生成，也支持模板模式快速起草。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>文档</Label>
                  <Select value={selectedDocumentId || '__none__'} onValueChange={(value) => setSelectedDocumentId(value === '__none__' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="选择文档" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">不绑定文档</SelectItem>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.filename}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-count">最大生成数量</Label>
                  <Input id="max-count" value={maxCount} onChange={(event) => setMaxCount(event.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <Label>模式选择</Label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={templateMode} onChange={(event) => setTemplateMode(event.target.checked)} />模板模式（无文字底图）
                </label>
              </div>

              <div className="space-y-3">
                <Label>图表类型</Label>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {FIGURE_TYPE_OPTIONS.map((option) => (
                    <button key={option.id} type="button" onClick={() => setFigureTypes((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id])} className={`rounded-2xl border p-3 text-left transition ${figureTypes.includes(option.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'}`}>
                      <div className="text-sm font-medium">{option.name}</div>
                      <div className={`mt-1 text-xs ${figureTypes.includes(option.id) ? 'text-slate-300' : 'text-slate-500'}`}>{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2"><Label htmlFor="custom-request">用户补充要求</Label><Textarea id="custom-request" value={customRequest} onChange={(event) => setCustomRequest(event.target.value)} rows={3} placeholder="例如：重点突出模块间数据流向，图例放在右下角。" /></div>
              <Button onClick={() => void handleGeneratePrompts()} disabled={isBusy}><Sparkles className="mr-2 h-4 w-4" />{isBusy ? '生成中...' : templateMode ? '生成模板草案' : '调用 Claude 生成'}</Button>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN: Prompt cards with per-image settings */}
        <div className="space-y-5">
          {prompts.length === 0 ? (
            <Card className="rounded-[28px] border-white/70 bg-white/80 p-8 shadow-xl shadow-slate-200/50">
              <CardTitle className="text-lg">还没有提示词</CardTitle>
              <CardDescription className="mt-2">上传文档、选择页码范围后，点击左侧"生成"按钮创建提示词。</CardDescription>
            </Card>
          ) : null}

          {prompts.map((prompt) => {
            const s = getSettings(prompt.id);
            const promptImages = images.filter((img) => img.promptId === prompt.id);
            const latestImage = promptImages.length > 0
              ? promptImages.reduce((a, b) => b.createdAt.localeCompare(a.createdAt) > 0 ? b : a)
              : null;

            return (
              <Card key={prompt.id} className="overflow-hidden rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
                {/* Image preview */}
                {latestImage?.previewDataUrl ? (
                  <img src={latestImage.previewDataUrl} alt={prompt.title ?? prompt.id} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-slate-100 text-sm text-slate-400">
                    {isBusy ? '生成中...' : '待生成图片'}
                  </div>
                )}

                {/* Title + badges */}
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle className="text-lg">{prompt.title || `Figure ${prompt.figureNumber}`}</CardTitle>
                    {prompt.suggestedFigureType ? <Badge variant="secondary">{prompt.suggestedFigureType}</Badge> : null}
                    {prompt.suggestedAspectRatio ? <Badge variant="outline">{prompt.suggestedAspectRatio}</Badge> : null}
                  </div>
                  <CardDescription>来源：{prompt.sourceSections?.titles.join(' / ') || '未绑定'} · {formatDate(prompt.updatedAt)}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Per-prompt settings: color scheme, aspect ratio, resolution */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">配色</label>
                      <Select value={s.colorScheme} onValueChange={(v) => updateSetting(prompt.id, 'colorScheme', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {colorSchemes.map((scheme) => <SelectItem key={scheme.id} value={scheme.id}>{scheme.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">比例</label>
                      <Select value={s.aspectRatio} onValueChange={(v) => updateSetting(prompt.id, 'aspectRatio', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{ASPECT_RATIO_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-slate-500">分辨率</label>
                      <Select value={s.resolution} onValueChange={(v) => updateSetting(prompt.id, 'resolution', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{RESOLUTION_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Prompt editor */}
                  <Textarea rows={6} className="text-xs" value={promptDrafts[prompt.id] ?? ''} onChange={(event) => setPromptDrafts((current) => ({ ...current, [prompt.id]: event.target.value }))} />

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" size="sm" onClick={() => void handleSavePrompt(prompt.id)}>保存修改</Button>
                    <Button size="sm" onClick={() => void handleGenerateImage(prompt.id)} disabled={isBusy}>
                      <ImagePlus className="mr-2 h-4 w-4" />{isBusy ? '生成中...' : '生成图片'}
                    </Button>
                    {latestImage?.previewDataUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={latestImage.previewDataUrl} download={`academic-figure-${latestImage.id}.png`}><Download className="mr-2 h-4 w-4" />下载</a>
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => void promptService.deletePrompt(prompt.id).then(loadWorkspace)}><Trash2 className="mr-2 h-4 w-4" />删除</Button>
                  </div>

                  {/* Previous images for this prompt */}
                  {promptImages.length > 1 ? (
                    <div className="space-y-2 border-t border-slate-200 pt-3">
                      <div className="text-xs text-slate-500">历史图片 ({promptImages.length})</div>
                      <div className="grid grid-cols-3 gap-2">
                        {promptImages.slice(0, 6).map((img) => (
                          <div key={img.id} className="relative group">
                            {img.previewDataUrl ? <img src={img.previewDataUrl} alt={img.id} className="aspect-[4/3] w-full rounded-lg object-cover" /> : null}
                            <div className="absolute inset-0 rounded-lg bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              {img.previewDataUrl ? (
                                <a href={img.previewDataUrl} download={`figure-${img.id}.png`} className="text-white text-xs"><Download className="h-4 w-4" /></a>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">{img.resolution} · {img.aspectRatio}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
