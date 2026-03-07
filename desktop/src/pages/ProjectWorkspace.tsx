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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { ASPECT_RATIO_OPTIONS, FIGURE_TYPE_OPTIONS, RESOLUTION_OPTIONS } from '../lib/catalog';
import { formatDate, formatFileSize } from '../lib/utils';
import { documentService } from '../services/documentService';
import { imageService } from '../services/imageService';
import { promptService } from '../services/promptService';
import { useProjectStore } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AspectRatio, DocumentRecord, FigureType, ImageRecord, PromptRecord, Resolution } from '../types/models';

export function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? '';
  const { currentProject, openProject, refreshProjects } = useProjectStore();
  const settings = useSettingsStore((state) => state.publicSettings);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('documents');
  const [isBusy, setIsBusy] = useState(false);

  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [figureTypes, setFigureTypes] = useState<FigureType[]>(['overall_framework']);
  const [customRequest, setCustomRequest] = useState('');
  const [maxCount, setMaxCount] = useState('3');
  const [templateMode, setTemplateMode] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [resolution, setResolution] = useState<Resolution>(settings?.defaultResolution ?? '2K');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(settings?.defaultAspectRatio ?? '4:3');
  const [referenceImage, setReferenceImage] = useState<File | undefined>();
  const [editInstruction, setEditInstruction] = useState('');

  const loadWorkspace = async () => {
    if (!projectId) return;
    const [project, nextDocuments, nextPrompts, nextImages] = await Promise.all([
      openProject(projectId),
      documentService.listDocuments(projectId),
      promptService.listPrompts(projectId),
      imageService.listImages(projectId),
    ]);
    if (!project) {
      setError('项目不存在或已被删除');
      return;
    }
    setDocuments(nextDocuments);
    setPrompts(nextPrompts);
    setImages(nextImages);
    setPromptDrafts(Object.fromEntries(nextPrompts.map((item) => [item.id, item.editedPrompt ?? item.originalPrompt ?? ''])));
    if (!selectedDocumentId && nextDocuments[0]) setSelectedDocumentId(nextDocuments[0].id);
    if (!selectedPromptId && nextPrompts[0]) setSelectedPromptId(nextPrompts[0].id);
  };

  useEffect(() => {
    void loadWorkspace();
  }, [projectId]);

  const currentDocument = useMemo(() => documents.find((item) => item.id === selectedDocumentId) ?? null, [documents, selectedDocumentId]);
  useEffect(() => {
    if (currentDocument) setSelectedSections(currentDocument.sections.map((section) => section.title));
  }, [currentDocument]);

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
        selectedSectionTitles: selectedSections,
        figureTypes,
        customRequest: customRequest.trim() || undefined,
        maxCount: Math.min(Math.max(Number(maxCount) || 1, 1), 10),
        templateMode,
      });
      await loadWorkspace();
      await refreshProjects();
      setActiveTab('prompts');
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

  const handleGenerateImage = async () => {
    if (!projectId || !selectedPromptId || !currentProject) return setError('请先选择要生成图片的提示词');
    setError('');
    setSuccess('');
    setIsBusy(true);
    try {
      await imageService.generateFromPrompt({
        projectId,
        promptId: selectedPromptId,
        resolution,
        aspectRatio,
        colorSchemeId: currentProject.colorScheme,
        referenceImage,
        editInstruction: editInstruction.trim() || undefined,
      });
      await loadWorkspace();
      await refreshProjects();
      setSuccess('图片已生成并保存在本地历史中');
      setReferenceImage(undefined);
      setEditInstruction('');
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '图片生成失败');
    } finally {
      setIsBusy(false);
    }
  };

  const selectedPrompt = prompts.find((item) => item.id === selectedPromptId);

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-xl shadow-slate-200/60">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Workspace</div>
            <h1 className="text-3xl font-semibold text-slate-950">{currentProject?.name ?? '加载中...'}</h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-600">{currentProject?.description || '这个项目还没有描述。你可以先上传文档，再根据章节生成提示词和配图。'}</p>
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-white/80 p-1 shadow-sm">
          <TabsTrigger value="documents">文档</TabsTrigger>
          <TabsTrigger value="prompts">提示词</TabsTrigger>
          <TabsTrigger value="images">图片</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardHeader><CardTitle>导入论文文档</CardTitle><CardDescription>支持 PDF / DOCX / TXT，桌面应用会直接解析正文，无需额外安装解析依赖。</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Label htmlFor="document-upload" className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-600">
                <FileUp className="h-4 w-4" />选择一个或多个文档
              </Label>
              <Input id="document-upload" type="file" accept=".pdf,.docx,.txt" multiple className="hidden" onChange={handleUpload} />
              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  {documents.map((document) => (
                    <button key={document.id} type="button" onClick={() => setSelectedDocumentId(document.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selectedDocumentId === document.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'}`}>
                      <div className="font-medium">{document.filename}</div>
                      <div className={`mt-1 text-xs ${selectedDocumentId === document.id ? 'text-slate-300' : 'text-slate-500'}`}>{formatFileSize(document.fileSizeBytes)} · {formatDate(document.createdAt)}</div>
                    </button>
                  ))}
                  {documents.length === 0 ? <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">还没有导入文档。</div> : null}
                </div>
                <Card className="border-slate-200/80 shadow-none">
                  <CardHeader><CardTitle className="text-lg">{currentDocument?.filename || '选择一个文档查看解析结果'}</CardTitle><CardDescription>{currentDocument ? `${currentDocument.sections.length} 个章节 · ${currentDocument.wordCount ?? 0} 词` : '文档章节结构会显示在这里。'}</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    {(currentDocument?.sections ?? []).map((section) => (
                      <div key={`${currentDocument?.id}-${section.title}`} className="rounded-2xl bg-slate-50 p-4">
                        <div className="font-medium text-slate-900">{section.title}</div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{section.content.slice(0, 280)}{section.content.length > 280 ? '...' : ''}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts" className="space-y-5">
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardHeader><CardTitle>生成学术配图提示词</CardTitle><CardDescription>支持基于文档章节调用 Claude，也支持纯模板模式快速起草。</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>文档</Label>
                  <Select value={selectedDocumentId || '__none__'} onValueChange={(value) => setSelectedDocumentId(value === '__none__' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="选择文档" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">不绑定文档</SelectItem>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.filename}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label htmlFor="max-count">最大生成数量</Label><Input id="max-count" value={maxCount} onChange={(event) => setMaxCount(event.target.value)} /></div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between"><Label>章节选择</Label><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={templateMode} onChange={(event) => setTemplateMode(event.target.checked)} />模板模式</label></div>
                <div className="grid gap-2 md:grid-cols-2">
                  {(currentDocument?.sections ?? []).map((section) => (
                    <label key={section.title} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <input type="checkbox" checked={selectedSections.includes(section.title)} onChange={(event) => setSelectedSections((current) => event.target.checked ? [...current, section.title] : current.filter((item) => item !== section.title))} />
                      <div><div className="font-medium text-slate-900">{section.title}</div><div className="mt-1 text-slate-500">{section.content.slice(0, 90)}{section.content.length > 90 ? '...' : ''}</div></div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Label>图表类型</Label>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {FIGURE_TYPE_OPTIONS.map((option) => (
                    <button key={option.id} type="button" onClick={() => setFigureTypes((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id])} className={`rounded-2xl border p-4 text-left transition ${figureTypes.includes(option.id) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'}`}>
                      <div className="font-medium">{option.name}</div>
                      <div className={`mt-2 text-xs ${figureTypes.includes(option.id) ? 'text-slate-300' : 'text-slate-500'}`}>{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2"><Label htmlFor="custom-request">用户补充要求</Label><Textarea id="custom-request" value={customRequest} onChange={(event) => setCustomRequest(event.target.value)} rows={4} placeholder="例如：重点突出模块间数据流向，图例放在右下角。" /></div>
              <Button onClick={() => void handleGeneratePrompts()} disabled={isBusy}><Sparkles className="mr-2 h-4 w-4" />{isBusy ? '生成中...' : templateMode ? '生成模板草案' : '调用 Claude 生成'}</Button>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {prompts.map((prompt) => (
              <Card key={prompt.id} className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3"><CardTitle className="text-lg">{prompt.title || `Figure ${prompt.figureNumber}`}</CardTitle>{prompt.suggestedFigureType ? <Badge variant="secondary">{prompt.suggestedFigureType}</Badge> : null}{prompt.suggestedAspectRatio ? <Badge variant="outline">{prompt.suggestedAspectRatio}</Badge> : null}</div>
                  <CardDescription>来源章节：{prompt.sourceSections?.titles.join(' / ') || '未绑定'} · 更新时间：{formatDate(prompt.updatedAt)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea rows={10} value={promptDrafts[prompt.id] ?? ''} onChange={(event) => setPromptDrafts((current) => ({ ...current, [prompt.id]: event.target.value }))} />
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => void handleSavePrompt(prompt.id)}>保存修改</Button>
                    <Button variant="outline" onClick={() => { setSelectedPromptId(prompt.id); setActiveTab('images'); }}>使用此 Prompt 生成图片</Button>
                    <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => void promptService.deletePrompt(prompt.id).then(loadWorkspace)}><Trash2 className="mr-2 h-4 w-4" />删除</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {prompts.length === 0 ? <Card className="rounded-[28px] border-white/70 bg-white/80 p-8 shadow-xl shadow-slate-200/50"><CardTitle className="text-lg">还没有提示词</CardTitle><CardDescription className="mt-2">上传文档后可以基于章节调用 Claude，也可以直接使用模板模式先起草。</CardDescription></Card> : null}
          </div>
        </TabsContent>

        <TabsContent value="images" className="space-y-5">
          <Card className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardHeader><CardTitle>生成与管理图片</CardTitle><CardDescription>从已有提示词生成图片，也支持附加参考图和编辑指令进行图生图。</CardDescription></CardHeader>
            <CardContent className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>选择 Prompt</Label>
                  <Select value={selectedPromptId || '__none__'} onValueChange={(value) => setSelectedPromptId(value === '__none__' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="选择 Prompt" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none__">请选择</SelectItem>{prompts.map((prompt) => <SelectItem key={prompt.id} value={prompt.id}>{prompt.title || `Figure ${prompt.figureNumber}`}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>分辨率</Label><Select value={resolution} onValueChange={(value) => setResolution(value as Resolution)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RESOLUTION_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>宽高比</Label><Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASPECT_RATIO_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <div className="space-y-2"><Label htmlFor="reference-image">参考图（可选）</Label><Input id="reference-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setReferenceImage(event.target.files?.[0])} /></div>
                <div className="space-y-2"><Label htmlFor="edit-instruction">编辑指令（可选）</Label><Textarea id="edit-instruction" value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} rows={4} /></div>
                <Button onClick={() => void handleGenerateImage()} disabled={isBusy || !selectedPromptId}><ImagePlus className="mr-2 h-4 w-4" />{isBusy ? '生成中...' : '生成图片'}</Button>
              </div>

              <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                <div><div className="text-sm font-medium text-slate-900">当前 Prompt 预览</div><p className="mt-2 text-sm leading-7 text-slate-600">{(selectedPrompt?.editedPrompt ?? selectedPrompt?.originalPrompt ?? '选择 Prompt 后预览内容会显示在这里。').slice(0, 900)}</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {images.map((image) => (
              <Card key={image.id} className="overflow-hidden rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
                {image.previewDataUrl ? <img src={image.previewDataUrl} alt={image.finalPromptSent ?? image.id} className="aspect-[4/3] w-full object-cover" /> : null}
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-500"><Badge variant="secondary">{image.resolution}</Badge><Badge variant="outline">{image.aspectRatio}</Badge><span>{formatDate(image.createdAt)}</span></div>
                  <p className="text-sm leading-6 text-slate-600">{(image.finalPromptSent ?? '').slice(0, 140)}{(image.finalPromptSent ?? '').length > 140 ? '...' : ''}</p>
                  <div className="flex flex-wrap gap-3">
                    {image.previewDataUrl ? <Button asChild variant="outline"><a href={image.previewDataUrl} download={`academic-figure-${image.id}.png`}><Download className="mr-2 h-4 w-4" />下载</a></Button> : null}
                    <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => void imageService.deleteImage(image.id).then(loadWorkspace)}><Trash2 className="mr-2 h-4 w-4" />删除</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {images.length === 0 ? <Card className="rounded-[28px] border-white/70 bg-white/80 p-8 shadow-xl shadow-slate-200/50 md:col-span-2 xl:col-span-3"><CardTitle className="text-lg">还没有生成图片</CardTitle><CardDescription className="mt-2">从上方选择一个 Prompt 并设置分辨率后即可开始生成。</CardDescription></Card> : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
