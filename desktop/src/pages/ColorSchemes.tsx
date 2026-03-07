import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { COLOR_ROLE_LABELS } from '../lib/catalog';
import { colorSchemeService } from '../services/colorSchemeService';
import type { ColorScheme, ColorValues } from '../types/models';

const initialColors: ColorValues = {
  primary: '#0072B2',
  secondary: '#E69F00',
  tertiary: '#009E73',
  text: '#333333',
  fill: '#FFFFFF',
  sectionBg: '#F7F7F7',
  border: '#CCCCCC',
  arrow: '#4D4D4D',
};

export function ColorSchemes() {
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [colors, setColors] = useState<ColorValues>(initialColors);

  const loadSchemes = async () => setSchemes(await colorSchemeService.listColorSchemes());
  useEffect(() => { void loadSchemes(); }, []);

  const handleOpenCreate = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setColors(initialColors);
    setOpen(true);
  };

  const handleOpenEdit = (scheme: ColorScheme) => {
    setEditingId(scheme.id);
    setName(scheme.name);
    setDescription(scheme.description);
    setColors(scheme.colors);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (editingId) await colorSchemeService.updateColorScheme(editingId, { name, description, colors });
    else await colorSchemeService.createColorScheme({ name, description, colors });
    setOpen(false);
    await loadSchemes();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Color Systems</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">配色方案</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">内置 9 套学术风格预设，也支持自定义语义色角色。项目会引用这里的色板生成提示词和图片。</p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="lg" onClick={handleOpenCreate}><Plus className="mr-2 h-4 w-4" />新建自定义方案</Button></DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{editingId ? '编辑配色方案' : '新建配色方案'}</DialogTitle><DialogDescription>定义 8 个语义颜色角色，供 Prompt 生成和图片风格统一使用。</DialogDescription></DialogHeader>
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4">
                <div className="space-y-2"><Label htmlFor="scheme-name">方案名称</Label><Input id="scheme-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="scheme-description">说明</Label><Textarea id="scheme-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(colors) as Array<keyof ColorValues>).map((key) => (
                  <label key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-medium text-slate-900">{COLOR_ROLE_LABELS[key]}</div>
                    <div className="mt-3 flex items-center gap-3">
                      <input type="color" value={colors[key]} onChange={(event) => setColors((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-16 rounded border border-slate-200 bg-white" />
                      <Input value={colors[key]} onChange={(event) => setColors((current) => ({ ...current, [key]: event.target.value }))} />
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={() => void handleSubmit()}>{editingId ? '保存修改' : '创建方案'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {schemes.map((scheme) => (
          <Card key={scheme.id} className="rounded-[28px] border-white/70 bg-white/85 shadow-xl shadow-slate-200/50">
            <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-xl">{scheme.name}</CardTitle><CardDescription className="mt-2">{scheme.description}</CardDescription></div><div className="text-xs text-slate-400">{scheme.isPreset ? 'Preset' : 'Custom'}</div></div></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-4 gap-3">{Object.entries(scheme.colors).map(([key, value]) => <div key={key} className="space-y-2"><div className="h-12 rounded-2xl border border-slate-200" style={{ backgroundColor: value }} /><div className="text-[11px] text-slate-500">{key}</div></div>)}</div>
              {!scheme.isPreset ? <div className="flex gap-3"><Button variant="outline" onClick={() => handleOpenEdit(scheme)}><Pencil className="mr-2 h-4 w-4" />编辑</Button><Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => void colorSchemeService.deleteColorScheme(scheme.id).then(loadSchemes)}><Trash2 className="mr-2 h-4 w-4" />删除</Button></div> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
