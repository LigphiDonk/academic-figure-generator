import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as z from 'zod';
import { format } from 'date-fns';
import { FileText, Image as ImageIcon, MessageSquare, Trash2, Plus, RefreshCw, Folder } from 'lucide-react';

import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';

import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';

const createProjectSchema = z.object({
    name: z.string().trim().min(1, '请输入项目名称'),
    description: z.string().trim().optional(),
    paper_field: z.string().trim().optional(),
    color_scheme: z.string().min(1, '请选择配色方案'),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;

export function Projects() {
    const { projects, setProjects } = useProjectStore();
    const token = useAuthStore((s) => s.token);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false); // Renamed from isDialogOpen
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CreateProjectValues, string>>>({});
    const [colorSchemes, setColorSchemes] = useState<Array<{ id: string; name: string }>>([]);
    const navigate = useNavigate();

    // New state variables for manual form handling
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');
    const [newProjectField, setNewProjectField] = useState('计算机科学'); // Default value
    const [selectedColorSchemeId, setSelectedColorSchemeId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchProjects = async () => {
        try {
            const response = await api.get('/projects/?page=1&page_size=100&status=active');
            setProjects(response.data.items || response.data || []);
        } catch (err) {
            console.error('Failed to fetch projects', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchColorSchemes = async () => {
        try {
            const response = await api.get('/color-schemes/');
            const schemes = response.data || [];
            setColorSchemes(schemes);
            if (schemes.length > 0) {
                const defaultSchemeId = schemes[0].id.toString();
                // Set default for manual state
                setSelectedColorSchemeId(defaultSchemeId);
            }
        } catch (err) {
            console.error('Failed to fetch color schemes', err);
            const fallbackSchemes = [
                { id: 'preset-okabe-ito', name: 'Okabe-Ito (Colorblind Safe, Recommended)' },
                { id: 'preset-ml-topconf-tab10', name: 'ML TopConf (Matplotlib Tab10)' },
                { id: 'preset-ml-topconf-colorblind', name: 'ML TopConf (Seaborn Colorblind)' },
                { id: 'preset-ml-topconf-deep', name: 'ML TopConf (Seaborn Deep)' },
            ];
            setColorSchemes(fallbackSchemes);
            setSelectedColorSchemeId(fallbackSchemes[0].id);
        }
    };

    useEffect(() => {
        // Wait until token is available (zustand persist may hydrate after first render).
        if (!token) {
            setProjects([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        fetchProjects();
        fetchColorSchemes();
    }, [token, setProjects]);

    const handleCreateProject = async () => {
        setError('');
        setFieldErrors({});

        const parsed = createProjectSchema.safeParse({
            name: newProjectName,
            description: newProjectDesc || undefined,
            paper_field: newProjectField || undefined,
            color_scheme: selectedColorSchemeId,
        });

        if (!parsed.success) {
            const nextErrors: Partial<Record<keyof CreateProjectValues, string>> = {};
            for (const issue of parsed.error.issues) {
                const key = issue.path[0] as keyof CreateProjectValues | undefined;
                if (key && !nextErrors[key]) nextErrors[key] = issue.message;
            }
            setFieldErrors(nextErrors);
            return;
        }

        setIsSubmitting(true);
        try {
            const payload: any = {
                name: parsed.data.name,
                description: parsed.data.description || null,
                paper_field: parsed.data.paper_field || null,
                color_scheme: parsed.data.color_scheme,
            };
            await api.post('/projects/', payload);
            await fetchProjects();
            setIsCreateModalOpen(false);

            // Reset form
            setNewProjectName('');
            setNewProjectDesc('');
            setNewProjectField('计算机科学'); // Reset to default
            const defaultSchemeId = colorSchemes[0]?.id?.toString() || '';
            setSelectedColorSchemeId(defaultSchemeId);
        } catch (e: any) {
            console.error(e);
            setError(e.response?.data?.detail || '项目创建失败，请重试');
        } finally {
            setIsSubmitting(false);
        }
    };


    const handleDelete = async (e: React.MouseEvent, id: number) => { // Changed id type to number based on original code
        e.stopPropagation();
        if (!confirm('确定要删除此项目吗？')) return;
        try {
            await api.delete(`/projects/${id}`);
            fetchProjects();
        } catch (err) {
            console.error('Failed to delete project', err);
            alert('删除项目失败，请重试');
        }
    };

    const handleProjectClick = (project: any) => {
        navigate(`/projects/${project.id}`);
    };

    const formatDate = (dateString: string) => {
        return format(new Date(dateString || new Date()), 'yyyy年M月d日');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">我的项目</h1>
                    <p className="text-muted-foreground mt-1">管理您的论文配图项目及文档</p>
                </div>

                <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" />
                            新建项目
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>新建配图项目</DialogTitle>
                            <DialogDescription>
                                创建一个新项目来组织您的论文、提示词和生成的配图。
                            </DialogDescription>
                        </DialogHeader>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleCreateProject();
                            }}
                            className="space-y-4"
                        >
                            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="name">项目名称 <span className="text-destructive">*</span></Label>
                                    <Input
                                        id="name"
                                        placeholder="例如：Attention Is All You Need"
                                        value={newProjectName}
                                        onChange={(e) => {
                                            setNewProjectName(e.target.value);
                                            if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                                        }}
                                    />
                                    {fieldErrors.name && <p className="text-sm font-medium text-destructive">{fieldErrors.name}</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="description">描述 (可选)</Label>
                                    <Input
                                        id="description"
                                        placeholder="项目简要说明..."
                                        value={newProjectDesc}
                                        onChange={e => setNewProjectDesc(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="field">研究领域</Label>
                                    <Input
                                        id="field"
                                        placeholder="例如：计算机视觉、NLP"
                                        value={newProjectField}
                                        onChange={(e) => {
                                            setNewProjectField(e.target.value);
                                            if (fieldErrors.paper_field) setFieldErrors((prev) => ({ ...prev, paper_field: undefined }));
                                        }}
                                    />
                                    {fieldErrors.paper_field && <p className="text-sm font-medium text-destructive">{fieldErrors.paper_field}</p>}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="colorscheme">默认配色方案</Label>
                                    <Select
                                        value={selectedColorSchemeId}
                                        onValueChange={(v) => {
                                            setSelectedColorSchemeId(v);
                                            if (fieldErrors.color_scheme) setFieldErrors((prev) => ({ ...prev, color_scheme: undefined }));
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="选择配色方案" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {colorSchemes.map(scheme => (
                                                <SelectItem key={scheme.id} value={scheme.id}>
                                                    {scheme.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {fieldErrors.color_scheme && <p className="text-sm font-medium text-destructive">{fieldErrors.color_scheme}</p>}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>取消</Button>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? '保存中...' : '创建项目'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {isLoading ? (
                <div className="flex justify-center items-center h-64 text-muted-foreground">
                    <RefreshCw className="w-8 h-8 animate-spin mb-4" />
                    <p className="ml-3">加载项目中...</p>
                </div>
            ) : projects.length === 0 ? (
                <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
                    <Folder className="w-12 h-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold">暂无项目</h3>
                    <p className="text-muted-foreground mt-2 max-w-sm">
                        您还没有创建任何项目。新建一个项目来开始管理您的文档并生成配图。
                    </p>
                    <Button className="mt-6" onClick={() => setIsCreateModalOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        新建项目
                    </Button>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map(project => (
                        <Card
                            key={project.id}
                            className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group"
                            onClick={() => handleProjectClick(project)}
                        >
                            <CardHeader className="pb-3 border-b">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <CardTitle className="text-xl line-clamp-1" title={project.name}>{project.name}</CardTitle>
                                        <CardDescription className="mt-1 flex items-center gap-2">
                                            {project.paper_field && <Badge variant="secondary" className="font-normal">{project.paper_field}</Badge>}
                                            <span className="text-xs">{formatDate(project.created_at)}</span>
                                        </CardDescription>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-2"
                                        onClick={(e) => handleDelete(e, project.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        <span className="sr-only">删除项目</span>
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-4">
                                <p className="text-sm text-muted-foreground line-clamp-2 h-10">
                                    {project.description || "无描述"}
                                </p>

                                <div className="mt-6 grid grid-cols-3 gap-2 text-center text-sm border-t pt-4">
                                    <div className="flex flex-col items-center justify-center">
                                        <span className="font-semibold text-foreground flex items-center"><FileText className="w-3.5 h-3.5 mr-1 text-blue-500" /> {project.document_count || 0}</span>
                                        <span className="text-xs text-muted-foreground">文档</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center border-l">
                                        <span className="font-semibold text-foreground flex items-center"><MessageSquare className="w-3.5 h-3.5 mr-1 text-green-500" /> {project.prompt_count || 0}</span>
                                        <span className="text-xs text-muted-foreground">提示词</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center border-l">
                                        <span className="font-semibold text-foreground flex items-center"><ImageIcon className="w-3.5 h-3.5 mr-1 text-purple-500" /> {project.image_count || 0}</span>
                                        <span className="text-xs text-muted-foreground">配图</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
