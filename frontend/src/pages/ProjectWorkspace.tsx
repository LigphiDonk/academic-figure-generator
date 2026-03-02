import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileUp, FileText, Image as ImageIcon, Send, RefreshCw, Download, ChevronLeft, ChevronRight } from 'lucide-react';

import { api } from '../lib/api';
import { useProjectStore } from '../store/projectStore';
import { fetchAuthedBlob, triggerBrowserDownload } from '../lib/blob';
import { useAuthStore } from '../store/authStore';

import { Button } from '../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

type DocumentItem = {
    id: string;
    original_filename: string;
    file_type: string;
    file_size_bytes: number;
    parse_status: 'pending' | 'parsing' | 'completed' | 'failed' | string;
    parse_error?: string | null;
    sections?: Array<{ title?: string; content?: string }> | null;
    created_at?: string;
};

type PromptSettings = {
    resolution: string;
    aspectRatio: string;
    colorScheme: string;
};

export function ProjectWorkspace() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { currentProject, setCurrentProject } = useProjectStore();
    const token = useAuthStore((s) => s.token);

    const [isLoading, setIsLoading] = useState(true);
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [prompts, setPrompts] = useState<any[]>([]);
    const [images, setImages] = useState<any[]>([]);

    // Upload state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Generation state
    const [isAutoGenerating, setIsAutoGenerating] = useState(false);
    const [isDownloading, setIsDownloading] = useState<string | null>(null);
    const [isPreviewing, setIsPreviewing] = useState<Record<string, boolean>>({});
    const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
    const previewUrlsRef = useRef<Record<string, string>>({});
    const [promptMode, setPromptMode] = useState<'overall' | 'sections'>('overall');
    const [promptRequest, setPromptRequest] = useState('');
    const [selectedSectionIndices, setSelectedSectionIndices] = useState<number[]>([]);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [showStructure, setShowStructure] = useState(true);
    const [showDocs, setShowDocs] = useState(true);

    // Per-image features
    const [colorSchemes, setColorSchemes] = useState<any[]>([]);
    const [editInstructions, setEditInstructions] = useState<Record<string, string>>({});
    const [isEditing, setIsEditing] = useState<Record<string, boolean>>({});
    const [promptSettings, setPromptSettings] = useState<Record<string, PromptSettings>>({});

    const getSettings = (promptId: string): PromptSettings => {
        if (promptSettings[promptId]) return promptSettings[promptId];
        const prompt = prompts.find(p => p.id === promptId);
        return {
            resolution: '2K',
            aspectRatio: prompt?.suggested_aspect_ratio || '16:9',
            colorScheme: currentProject?.color_scheme || 'okabe-ito',
        };
    };

    const updateSetting = (promptId: string, field: keyof PromptSettings, value: string) => {
        setPromptSettings(prev => ({
            ...prev,
            [promptId]: {
                ...(prev[promptId] || getSettings(promptId)),
                [field]: value,
            },
        }));
    };

    useEffect(() => {
        if (id && token) {
            fetchProjectData(id);
        }
        return () => setCurrentProject(null);
    }, [id, token]);

    useEffect(() => {
        return () => {
            for (const url of Object.values(previewUrlsRef.current)) {
                try { URL.revokeObjectURL(url); } catch { /* ignore */ }
            }
            previewUrlsRef.current = {};
        };
    }, []);

    // Poll while any image is still processing
    useEffect(() => {
        const hasProcessing = images.some(img => img.generation_status === 'processing');
        if (!hasProcessing || !id) return;
        const interval = setInterval(() => { fetchProjectData(id); }, 5000);
        return () => clearInterval(interval);
    }, [images, id]);

    const fetchProjectData = async (projectId: string) => {
        setIsLoading(true);
        try {
            const projRes = await api.get(`/projects/${projectId}`);
            setCurrentProject(projRes.data);

            try {
                const docsRes = await api.get(`/projects/${projectId}/documents`);
                const nextDocs = docsRes.data || [];
                setDocuments(nextDocs);
                const firstParsed = nextDocs.find(
                    (d: any) => d.parse_status === 'completed' && Array.isArray(d.sections) && d.sections.length > 0
                );
                if (firstParsed?.sections?.length && selectedSectionIndices.length === 0) {
                    setSelectedSectionIndices(firstParsed.sections.map((_: any, idx: number) => idx));
                }
            } catch (e) {
                console.debug('Failed to fetch documents', e);
                setDocuments([]);
            }

            try {
                const promptsRes = await api.get(`/projects/${projectId}/prompts`);
                setPrompts(promptsRes.data);
            } catch (e) {
                console.debug('Failed to fetch prompts', e);
            }

            try {
                const imagesRes = await api.get(`/projects/${projectId}/images`);
                setImages(imagesRes.data);
            } catch (e) {
                console.debug('Failed to fetch images', e);
            }

            try {
                const schemesRes = await api.get('/color-schemes/');
                setColorSchemes(schemesRes.data || []);
            } catch (e) {
                console.debug('Failed to fetch color schemes', e);
            }

        } catch (err) {
            console.error(err);
            navigate('/projects');
        } finally {
            setIsLoading(false);
        }
    };

    const ensureImagePreview = useCallback(async (imageId: string) => {
        if (imagePreviews[imageId]) return;
        if (isPreviewing[imageId]) return;

        setIsPreviewing(prev => ({ ...prev, [imageId]: true }));
        try {
            const { blob } = await fetchAuthedBlob(`/images/${imageId}/download`);
            const url = URL.createObjectURL(blob);

            const old = previewUrlsRef.current[imageId];
            if (old) { try { URL.revokeObjectURL(old); } catch { /* ignore */ } }
            previewUrlsRef.current[imageId] = url;
            setImagePreviews(prev => ({ ...prev, [imageId]: url }));
        } catch (err) {
            console.error('Preview fetch failed', err);
        } finally {
            setIsPreviewing(prev => ({ ...prev, [imageId]: false }));
        }
    }, [imagePreviews, isPreviewing]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !id) return;

        setIsUploading(true);
        setUploadProgress(0);
        const formData = new FormData();
        formData.append('file', file);

        try {
            await api.post(`/projects/${id}/documents`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (evt) => {
                    const total = evt.total || 0;
                    if (!total) return;
                    setUploadProgress(Math.min(100, Math.round((evt.loaded / total) * 100)));
                },
            });
            await fetchProjectData(id);
            alert('文件上传成功，已加入解析队列。');
        } catch (err: any) {
            console.error('File upload failed', err);
            const detail = err?.response?.data?.detail;
            alert(detail ? `文件上传失败：${detail}` : '文件上传失败，请检查后端/存储服务是否正常。');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDownloadImage = async (imageId: string) => {
        try {
            setIsDownloading(imageId);
            const { blob, ext } = await fetchAuthedBlob(`/images/${imageId}/download`);
            triggerBrowserDownload(blob, `academic-figure-${imageId}.${ext}`);
        } catch (err: any) {
            console.error('Download failed', err);
            const detail = err?.response?.data?.detail;
            alert(detail ? `下载失败：${detail}` : '下载失败，请稍后重试。');
        } finally {
            setIsDownloading(null);
        }
    };

    /** Generate prompts then auto-trigger image generation for each new prompt */
    const handleAutoGenerate = async () => {
        if (!id) return;

        const parsedDoc = documents.find((d) => d.parse_status === 'completed' && Array.isArray(d.sections) && d.sections.length > 0);
        if (!parsedDoc) {
            alert('请先上传文档并等待解析完成，再生成配图。');
            return;
        }

        if (promptMode === 'sections' && selectedSectionIndices.length === 0) {
            alert('请至少选择一个章节。');
            return;
        }

        setIsAutoGenerating(true);
        try {
            const beforeCount = prompts.length;
            const payload: any = {
                section_indices: selectedSectionIndices.length ? selectedSectionIndices : null,
                color_scheme: currentProject?.color_scheme || 'okabe-ito',
                figure_types: promptMode === 'overall' ? ['overall_framework'] : null,
                user_request: promptRequest.trim() ? promptRequest.trim() : null,
                max_figures: promptMode === 'overall' ? 1 : null,
            };

            await api.post(`/projects/${id}/prompts/generate`, payload);

            // Poll until new prompts appear
            let newPrompts: any[] = [];
            const deadline = Date.now() + 90_000;
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 2000));
                const promptsRes = await api.get(`/projects/${id}/prompts`);
                const next = promptsRes.data || [];
                setPrompts(next);
                if (next.length > beforeCount) {
                    newPrompts = next.slice(beforeCount);
                    break;
                }
            }

            // Auto-trigger image generation for each new prompt
            for (const prompt of newPrompts) {
                const aspectRatio = prompt.suggested_aspect_ratio || '16:9';
                const cs = currentProject?.color_scheme || 'okabe-ito';
                // Initialize per-prompt settings
                setPromptSettings(prev => ({
                    ...prev,
                    [prompt.id]: { resolution: '2K', aspectRatio, colorScheme: cs },
                }));
                try {
                    await api.post(`/prompts/${prompt.id}/images/generate`, {
                        resolution: '2K',
                        aspect_ratio: aspectRatio,
                        color_scheme: cs,
                    });
                } catch (err) {
                    console.error('Auto image generation failed for prompt', prompt.id, err);
                }
            }

            // Refresh to pick up image records
            await fetchProjectData(id);
        } catch (err: any) {
            console.error('Failed to auto-generate', err);
            const detail = err?.response?.data?.detail;
            alert(detail ? `生成配图失败：${detail}` : '生成配图失败，请稍后重试。');
        } finally {
            setIsAutoGenerating(false);
        }
    };

    /** Generate (or re-generate) an image for a single prompt using its current settings */
    const handleGenerateImage = async (promptId: string) => {
        if (!id) return;
        const settings = getSettings(promptId);
        try {
            await api.post(`/prompts/${promptId}/images/generate`, {
                resolution: settings.resolution,
                aspect_ratio: settings.aspectRatio,
                color_scheme: settings.colorScheme,
            });
            await fetchProjectData(id);
        } catch (err) {
            console.error('Failed to generate image', err);
            alert('生成图像失败，请稍后重试。');
        }
    };

    /** Edit an existing image with a text instruction (image-to-image) */
    const handleEditImage = async (imageId: string) => {
        const instruction = editInstructions[imageId]?.trim();
        if (!instruction || !id) return;

        setIsEditing(prev => ({ ...prev, [imageId]: true }));
        try {
            const formData = new FormData();
            formData.append('edit_instruction', instruction);
            await api.post(`/images/${imageId}/edit`, formData);
            setEditInstructions(prev => ({ ...prev, [imageId]: '' }));
            await fetchProjectData(id);
        } catch (err: any) {
            console.error('Edit image failed', err);
            const detail = err?.response?.data?.detail;
            alert(detail ? `改图失败：${detail}` : '改图失败，请稍后重试。');
        } finally {
            setIsEditing(prev => ({ ...prev, [imageId]: false }));
        }
    };

    if (isLoading) return <div className="p-8">加载中...</div>;
    if (!currentProject) return <div className="p-8">找不到该项目...</div>;

    const renderParsedStructure = () => {
        const parsedDoc = documents.find((d) => d.parse_status === 'completed' && Array.isArray(d.sections) && d.sections.length > 0);
        if (!parsedDoc) return <div className="text-sm text-muted-foreground">上传文档并等待解析完成后，这里会显示章节结构。</div>;

        const sections = parsedDoc.sections || [];

        const getGroupKeyAndTitle = (rawTitle: string | undefined | null) => {
            const title = (rawTitle || '').trim();
            if (!title) return null;

            const cn = title.match(/^第\s*([0-9一二三四五六七八九十百千]+)\s*章\s*[:：]?\s*(.*)$/);
            if (cn) {
                const idx = cn[1];
                const rest = (cn[2] || '').trim();
                return { key: `chapter-${idx}`, title: rest ? `第${idx}章：${rest}` : `第${idx}章` };
            }

            const en = title.match(/^chapter\s+(\d+)\b\s*[:：-]?\s*(.*)$/i);
            if (en) {
                const idx = en[1];
                const rest = (en[2] || '').trim();
                return { key: `chapter-${idx}`, title: rest ? `Chapter ${idx}: ${rest}` : `Chapter ${idx}` };
            }

            if (/^(摘要|abstract|引言|introduction|结论|conclusion|参考文献|references)\b/i.test(title)) {
                return { key: `section-${title.toLowerCase()}`, title };
            }

            return null;
        };

        type Group = {
            key: string;
            title: string;
            items: Array<{ idx: number; title: string; preview: string }>;
        };

        const groups: Group[] = [];
        let current: Group | null = null;

        sections.forEach((sec: any, idx: number) => {
            const groupInfo = getGroupKeyAndTitle(sec?.title);
            if (groupInfo) {
                current = groups.find((g) => g.key === groupInfo.key) || null;
                if (!current) {
                    current = { key: groupInfo.key, title: groupInfo.title, items: [] };
                    groups.push(current);
                }
            }
            if (!current) {
                current = groups.find((g) => g.key === 'misc') || null;
                if (!current) {
                    current = { key: 'misc', title: '其他', items: [] };
                    groups.push(current);
                }
            }

            const previewText = (sec?.content || sec?.text || '').toString().trim();
            current.items.push({
                idx,
                title: (sec?.title || `Section ${idx + 1}`).toString(),
                preview: previewText,
            });
        });

        const allIndices = sections.map((_, idx) => idx);
        const selectedSet = new Set(selectedSectionIndices);

        const selectMany = (indices: number[], checked: boolean) => {
            setSelectedSectionIndices((prev) => {
                const set = new Set(prev);
                for (const i of indices) {
                    if (checked) set.add(i);
                    else set.delete(i);
                }
                return Array.from(set).sort((a, b) => a - b);
            });
        };

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs text-muted-foreground">
                        已选择 {selectedSectionIndices.length}/{sections.length} 段
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectMany(allIndices, true)}
                        >
                            全选
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectMany(allIndices, false)}
                        >
                            全不选
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const next: Record<string, boolean> = {};
                                for (const g of groups) next[g.key] = false;
                                setCollapsedGroups(next);
                            }}
                        >
                            展开
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const next: Record<string, boolean> = {};
                                for (const g of groups) next[g.key] = true;
                                setCollapsedGroups(next);
                            }}
                        >
                            折叠
                        </Button>
                    </div>
                </div>

                <div className="space-y-2">
                    {groups.map((g) => {
                        const indices = g.items.map((it) => it.idx);
                        const selectedCount = indices.reduce((acc, i) => acc + (selectedSet.has(i) ? 1 : 0), 0);
                        const allChecked = selectedCount === indices.length && indices.length > 0;
                        const partiallyChecked = selectedCount > 0 && selectedCount < indices.length;
                        const isCollapsed = collapsedGroups[g.key] ?? false;

                        return (
                            <details
                                key={g.key}
                                open={!isCollapsed}
                                className="rounded border bg-muted/20"
                                onToggle={(e) => {
                                    const open = (e.currentTarget as HTMLDetailsElement).open;
                                    setCollapsedGroups((prev) => ({ ...prev, [g.key]: !open }));
                                }}
                            >
                                <summary className="cursor-pointer select-none list-none px-3 py-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5"
                                            checked={allChecked}
                                            ref={(el) => {
                                                if (el) el.indeterminate = partiallyChecked;
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => selectMany(indices, e.target.checked)}
                                        />
                                        <div className="min-w-0">
                                            <div className="text-sm font-medium truncate">{g.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {selectedCount}/{indices.length} 已选
                                            </div>
                                        </div>
                                    </div>
                                    <Badge variant="secondary">{indices.length}</Badge>
                                </summary>

                                <div className="px-3 pb-3 space-y-2">
                                    {g.items.map((it) => (
                                        <div key={it.idx} className="flex items-start space-x-2 p-3 bg-background/60 rounded border">
                                            <input
                                                type="checkbox"
                                                className="mt-1"
                                                checked={selectedSet.has(it.idx)}
                                                onChange={(e) => selectMany([it.idx], e.target.checked)}
                                            />
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium leading-none truncate">{it.title}</p>
                                                {it.preview && (
                                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.preview}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="h-[calc(100vh-6rem)] flex gap-4 overflow-hidden">

            {/* Column 1: Parsed Structure (primary) */}
            {showStructure ? (
                <Card className="w-[420px] xl:w-[480px] 2xl:w-[540px] flex flex-col h-full border-r shadow-none shrink-0">
                    <CardHeader className="bg-muted/30 border-b py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center">
                                <FileText className="w-5 h-5 mr-2 text-primary" />
                                论文结构
                            </CardTitle>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowStructure(false)}
                                title="收起论文结构"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
                        <div className="px-4 py-3 border-b bg-background">
                            <div className="text-xs text-muted-foreground">用于限定提示词生成范围（按章节折叠选择）。</div>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            {renderParsedStructure()}
                        </ScrollArea>
                    </CardContent>
                </Card>
            ) : (
                <div className="h-full w-10 shrink-0 flex items-center justify-center border rounded bg-card">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowStructure(true)}
                        title="展开论文结构"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Column 2: Documents + Settings (secondary) */}
            {showDocs ? (
                <Card className="w-[360px] xl:w-[400px] flex flex-col h-full border-r shadow-none shrink-0">
                    <CardHeader className="bg-muted/30 border-b py-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center">
                                <FileText className="w-5 h-5 mr-2 text-primary" />
                                参考文档
                            </CardTitle>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowDocs(false)}
                                title="收起参考文档"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">

                    {/* Upload + settings (secondary) */}
                    <div className="bg-background">
                        <div className="p-4 border-b">
                            <div className="text-sm font-medium text-muted-foreground mb-2">你想生成什么图？（可选）</div>
                            <Textarea
                                value={promptRequest}
                                onChange={(e) => setPromptRequest(e.target.value)}
                                placeholder="例如：只生成一张整体架构图（包含输入、编码器、融合模块、输出），突出本文主要贡献点。"
                                className="min-h-[70px]"
                            />
                            <div className="flex items-center justify-between gap-2 mt-3">
                                <div className="text-sm font-medium text-muted-foreground">生成方式</div>
                                <Select value={promptMode} onValueChange={(v) => setPromptMode(v as any)}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="overall">整体架构图（1条）</SelectItem>
                                        <SelectItem value="sections">按章节生成（多条）</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                章节勾选对两种方式都生效（用于限定参考范围）。
                            </p>
                        </div>

                        <div className="p-4 border-b">
                            <div
                                className="border-2 border-dashed rounded-lg p-4 text-center hover:bg-muted/50 transition-colors cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
                                <FileUp className="w-7 h-7 mx-auto text-muted-foreground mb-2" />
                                <p className="text-sm font-medium">点击或拖拽以上传</p>
                                <p className="text-xs text-muted-foreground mt-1">支持 PDF, DOCX, TXT (最大 50MB)</p>
                            </div>

                            {isUploading && (
                                <div className="mt-4 space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span>上传中...</span>
                                        <span>{uploadProgress}%</span>
                                    </div>
                                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                        <div className="bg-primary h-full transition-all" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-b">
                            <div className="text-sm font-medium text-muted-foreground mb-2">已上传文档</div>
                            {documents.length === 0 ? (
                                <div className="text-sm text-muted-foreground">暂无文档，请先上传 PDF / DOCX / TXT。</div>
                            ) : (
                                <div className="space-y-2">
                                    {documents.map((doc) => (
                                        <div key={doc.id} className="flex items-start justify-between gap-2 p-3 bg-muted/20 rounded border">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium truncate">{doc.original_filename}</p>
                                                {doc.parse_status === 'failed' && doc.parse_error && (
                                                    <p className="text-xs text-destructive mt-1 line-clamp-2">{doc.parse_error}</p>
                                                )}
                                            </div>
                                            <Badge variant={doc.parse_status === 'completed' ? 'secondary' : doc.parse_status === 'failed' ? 'destructive' : 'outline'}>
                                                {doc.parse_status}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    </CardContent>
                    <CardFooter className="p-4 border-t bg-muted/10">
                        <Button className="w-full font-semibold" onClick={handleAutoGenerate} disabled={isAutoGenerating}>
                            {isAutoGenerating ? (
                                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> 生成配图中...</>
                            ) : (
                                <><Send className="w-4 h-4 mr-2" /> 生成配图</>
                            )}
                        </Button>
                    </CardFooter>
                </Card>
            ) : (
                <div className="h-full w-10 shrink-0 flex items-center justify-center border rounded bg-card">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowDocs(true)}
                        title="展开参考文档"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Right Column: Image Cards (no tabs) */}
            <div className="flex-1 flex flex-col h-full">
                <div className="bg-muted/30 border-b py-4 px-6 flex items-center">
                    <ImageIcon className="w-5 h-5 mr-2 text-primary" />
                    <h3 className="text-lg font-semibold">配图生成</h3>
                </div>
                <ScrollArea className="flex-1">
                    <div className="p-4">
                        {prompts.length === 0 ? (
                            <div className="text-center text-muted-foreground mt-20">
                                {isAutoGenerating ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                                        <span>正在生成配图...</span>
                                    </div>
                                ) : (
                                    '上传文档后点击"生成配图"开始。'
                                )}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {prompts.map(prompt => {
                                    const promptImgs = images.filter(img => img.prompt_id === prompt.id);
                                    const latestImg = promptImgs.length > 0
                                        ? promptImgs.reduce((a: any, b: any) =>
                                            new Date(b.created_at || 0).getTime() > new Date(a.created_at || 0).getTime() ? b : a
                                        )
                                        : null;
                                    const settings = getSettings(prompt.id);
                                    const isCompleted = latestImg?.generation_status === 'completed';
                                    const isProcessing = latestImg?.generation_status === 'processing';

                                    return (
                                        <Card key={prompt.id} className="overflow-hidden">
                                            {/* Image Preview */}
                                            <div className="aspect-video bg-muted relative">
                                                {isCompleted && latestImg && imagePreviews[latestImg.id] ? (
                                                    <img
                                                        src={imagePreviews[latestImg.id]}
                                                        alt={prompt.title || 'Generated Figure'}
                                                        className="w-full h-full object-cover"
                                                        onError={() => {
                                                            setImagePreviews(prev => {
                                                                const next = { ...prev };
                                                                delete next[latestImg.id];
                                                                return next;
                                                            });
                                                        }}
                                                    />
                                                ) : isCompleted && latestImg ? (
                                                    <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                                                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            disabled={!!isPreviewing[latestImg.id]}
                                                            onClick={() => ensureImagePreview(latestImg.id)}
                                                        >
                                                            {isPreviewing[latestImg.id] ? '加载中...' : '预览'}
                                                        </Button>
                                                    </div>
                                                ) : isProcessing ? (
                                                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                                                        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                                                        <span className="mt-2 text-sm font-medium">生成中...</span>
                                                    </div>
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                                                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                                        <span className="mt-2 text-sm text-muted-foreground">
                                                            {latestImg ? latestImg.generation_status : '待生成'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Title + Type Badge */}
                                            <CardHeader className="pb-2">
                                                <div className="flex justify-between items-center">
                                                    <CardTitle className="text-base">
                                                        {prompt.title || `Figure ${prompt.figure_number ?? ''}`}
                                                    </CardTitle>
                                                    <Badge>{prompt.suggested_figure_type || '未分类'}</Badge>
                                                </div>
                                            </CardHeader>

                                            {/* Per-card Settings */}
                                            <CardContent className="pb-3">
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">配色</label>
                                                        <Select
                                                            value={settings.colorScheme}
                                                            onValueChange={(v) => updateSetting(prompt.id, 'colorScheme', v)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {colorSchemes.length > 0 ? (
                                                                    colorSchemes.map(scheme => {
                                                                        const val = typeof scheme === 'string' ? scheme : (scheme.name || scheme.id);
                                                                        const label = typeof scheme === 'string' ? scheme : (scheme.display_name || scheme.name || scheme.id);
                                                                        return <SelectItem key={val} value={val}>{label}</SelectItem>;
                                                                    })
                                                                ) : (
                                                                    <SelectItem value="okabe-ito">Okabe-Ito</SelectItem>
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">比例</label>
                                                        <Select
                                                            value={settings.aspectRatio}
                                                            onValueChange={(v) => updateSetting(prompt.id, 'aspectRatio', v)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'].map(r => (
                                                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">分辨率</label>
                                                        <Select
                                                            value={settings.resolution}
                                                            onValueChange={(v) => updateSetting(prompt.id, 'resolution', v)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {['1K', '2K', '4K'].map(r => (
                                                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            </CardContent>

                                            {/* Action Buttons */}
                                            <CardFooter className="flex gap-2 border-t pt-3">
                                                {!latestImg ? (
                                                    <Button size="sm" onClick={() => handleGenerateImage(prompt.id)}>
                                                        <ImageIcon className="mr-2 h-4 w-4" />
                                                        生成图片
                                                    </Button>
                                                ) : (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleGenerateImage(prompt.id)}
                                                            disabled={isProcessing}
                                                        >
                                                            <RefreshCw className="mr-1 h-3 w-3" />
                                                            重新生成
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            disabled={!isCompleted || isDownloading === latestImg.id}
                                                            onClick={() => handleDownloadImage(latestImg.id)}
                                                        >
                                                            <Download className="mr-1 h-3 w-3" />
                                                            下载
                                                        </Button>
                                                    </>
                                                )}
                                            </CardFooter>

                                            {/* Edit (image-to-image) section */}
                                            {isCompleted && latestImg && (
                                                <div className="border-t px-4 py-3">
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                            placeholder="输入改图需求..."
                                                            value={editInstructions[latestImg.id] || ''}
                                                            onChange={(e) => setEditInstructions(prev => ({ ...prev, [latestImg.id]: e.target.value }))}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                                    e.preventDefault();
                                                                    handleEditImage(latestImg.id);
                                                                }
                                                            }}
                                                        />
                                                        <Button
                                                            size="sm"
                                                            disabled={!editInstructions[latestImg.id]?.trim() || !!isEditing[latestImg.id]}
                                                            onClick={() => handleEditImage(latestImg.id)}
                                                        >
                                                            {isEditing[latestImg.id] ? (
                                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <Send className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </Card>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
