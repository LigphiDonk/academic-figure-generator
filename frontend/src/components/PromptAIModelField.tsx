import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export interface PromptAIModelOption {
    id: string;
    display_name: string;
}

interface PromptAIModelFieldProps {
    id: string;
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    onFetch: () => void | Promise<void>;
    isFetching: boolean;
    models: PromptAIModelOption[];
    fetchHint: string;
    message: string;
    error: string;
}

export function PromptAIModelField({
    id,
    label,
    placeholder,
    value,
    onChange,
    onFetch,
    isFetching,
    models,
    fetchHint,
    message,
    error,
}: PromptAIModelFieldProps) {
    const [isOpen, setIsOpen] = useState(false);

    const keyword = value.trim().toLowerCase();
    const filteredModels = models.filter(model => {
        if (!keyword) return true;
        return (
            model.id.toLowerCase().includes(keyword) ||
            model.display_name.toLowerCase().includes(keyword)
        );
    });

    useEffect(() => {
        if (models.length === 0) {
            setIsOpen(false);
        }
    }, [models]);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>{label}</Label>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onFetch}
                    disabled={isFetching}
                >
                    {isFetching && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                    拉取模型
                </Button>
            </div>

            <div className="relative">
                <Input
                    id={id}
                    placeholder={placeholder}
                    value={value}
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={models.length > 0 && isOpen}
                    onFocus={() => {
                        if (models.length > 0) setIsOpen(true);
                    }}
                    onBlur={() => {
                        window.setTimeout(() => setIsOpen(false), 120);
                    }}
                    onChange={event => {
                        onChange(event.target.value);
                        if (models.length > 0) setIsOpen(true);
                    }}
                />

                {models.length > 0 && isOpen && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-md border bg-background shadow-md">
                        <div className="max-h-56 overflow-y-auto py-1">
                            {filteredModels.length > 0 ? (
                                filteredModels.map(model => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                                        onMouseDown={event => {
                                            // 防止点击候选时先触发 input blur，导致列表提前关闭。
                                            event.preventDefault();
                                        }}
                                        onClick={() => {
                                            onChange(model.id);
                                            setIsOpen(false);
                                        }}
                                    >
                                        <div className="font-medium text-foreground">{model.display_name}</div>
                                        {model.display_name !== model.id && (
                                            <div className="text-xs text-muted-foreground">{model.id}</div>
                                        )}
                                    </button>
                                ))
                            ) : (
                                <div className="px-3 py-2 text-sm text-muted-foreground">
                                    没有匹配的已拉取模型，可继续手动输入。
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <p className="text-xs text-muted-foreground">{fetchHint}</p>
            {message && <p className="text-xs text-muted-foreground">{message}</p>}
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
}
