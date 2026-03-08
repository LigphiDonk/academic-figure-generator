import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, ImageIcon, MessageSquare, Plus, Search, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { formatDate } from '../lib/utils';
import { projectService } from '../services/projectService';
import { useProjectStore } from '../store/projectStore';

export function Projects() {
  const navigate = useNavigate();
  const { projects, isLoading, refreshProjects } = useProjectStore();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [paperField, setPaperField] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        [project.name, project.description ?? '', project.paperField ?? '']
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [projects, search],
  );

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) return setError('请输入项目名称');
    setIsSubmitting(true);
    try {
      await projectService.createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        paperField: paperField.trim() || undefined,
      });
      await refreshProjects();
      setName('');
      setDescription('');
      setPaperField('');
      setOpen(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建项目失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (projectId: string) => {
    if (!window.confirm('删除项目会同时移除关联文档、提示词和图片，是否继续？')) return;
    await projectService.deleteProject(projectId);
    await refreshProjects();
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-5 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-xl shadow-slate-200/60 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Projects</div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950">论文项目工作区</h1>
          <p className="max-w-2xl text-sm leading-7 text-slate-600">每个项目对应一篇论文或一组配图任务。文档解析、提示词生成和图片历史都会在这里按项目归档。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>活跃项目</CardDescription><CardTitle>{projects.length}</CardTitle></CardHeader></Card>
          <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>文档总数</CardDescription><CardTitle>{projects.reduce((sum, item) => sum + item.documentCount, 0)}</CardTitle></CardHeader></Card>
          <Card className="border-slate-200/80 bg-slate-50/70 shadow-none"><CardHeader className="pb-2"><CardDescription>图片总数</CardDescription><CardTitle>{projects.reduce((sum, item) => sum + item.imageCount, 0)}</CardTitle></CardHeader></Card>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="搜索项目名称、描述或领域" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="lg"><Plus className="mr-2 h-4 w-4" />新建项目</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>建立一个桌面端项目工作区，用于管理文档、提示词与最终图片。</DialogDescription></DialogHeader>
            <div className="space-y-4">
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
              <div className="space-y-2"><Label htmlFor="project-name">项目名称</Label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="project-description">描述</Label><Input id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="project-field">研究领域</Label><Input id="project-field" value={paperField} onChange={(event) => setPaperField(event.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={() => void handleCreate()} disabled={isSubmitting}>{isSubmitting ? '创建中...' : '创建项目'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card className="rounded-[28px] border-white/70 bg-white/80 p-8 text-center shadow-xl shadow-slate-200/50">正在加载项目...</Card>
      ) : filteredProjects.length === 0 ? (
        <Card className="rounded-[28px] border-dashed border-slate-300 bg-white/80 p-12 text-center shadow-lg shadow-slate-200/40">
          <CardTitle className="text-xl">还没有项目</CardTitle>
          <CardDescription className="mx-auto mt-2 max-w-md leading-7">从一个新项目开始，把论文文档、章节上下文、提示词版本和生成图片全部收进同一个桌面工作区。</CardDescription>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((project) => (
            <Card key={project.id} className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/60 transition hover:-translate-y-0.5 hover:shadow-2xl">
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <CardTitle className="text-xl">{project.name}</CardTitle>
                    <CardDescription>{project.paperField || '未填写研究领域'}</CardDescription>
                  </div>
                  <Button variant="ghost" size="icon" className="opacity-70 hover:text-red-600" onClick={() => void handleDelete(project.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <p className="min-h-12 text-sm leading-6 text-slate-600">{project.description || '这个项目还没有描述。'}</p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2 text-slate-500"><FileText className="h-4 w-4" />文档</div><div className="mt-2 text-lg font-semibold">{project.documentCount}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2 text-slate-500"><MessageSquare className="h-4 w-4" />Prompt</div><div className="mt-2 text-lg font-semibold">{project.promptCount}</div></div>
                  <div className="rounded-2xl bg-slate-50 p-3 text-sm"><div className="flex items-center gap-2 text-slate-500"><ImageIcon className="h-4 w-4" />图片</div><div className="mt-2 text-lg font-semibold">{project.imageCount}</div></div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>最近更新：{formatDate(project.updatedAt)}</span>
                  <Button variant="outline" onClick={() => navigate(`/projects/${project.id}`)}>进入工作区</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
