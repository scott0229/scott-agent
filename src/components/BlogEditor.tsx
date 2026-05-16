'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useTheme } from '@/contexts/ThemeContext';
import { Loader2, Save, ArrowLeft, X } from 'lucide-react';

import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

export interface BlogEditorInitial {
    title?: string;
    content?: string;
    category?: string | null;
    tags?: string[];
    published_at?: string;
}

interface BlogEditorProps {
    mode: 'create' | 'edit';
    postId?: number;
    initial?: BlogEditorInitial;
}

function todayDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function BlogEditor({ mode, postId, initial }: BlogEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const { theme } = useTheme();

    const [title, setTitle] = useState(initial?.title ?? '');
    const [content, setContent] = useState(initial?.content ?? '');
    const [category, setCategory] = useState(initial?.category ?? '');
    const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(', '));
    const [publishedAt, setPublishedAt] = useState(initial?.published_at ?? todayDateString());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (initial) {
            setTitle(initial.title ?? '');
            setContent(initial.content ?? '');
            setCategory(initial.category ?? '');
            setTagsInput((initial.tags ?? []).join(', '));
            setPublishedAt(initial.published_at ?? todayDateString());
        }
    }, [initial]);

    const handleSave = async () => {
        if (!title.trim()) {
            toast({ variant: 'destructive', title: '請填寫標題' });
            return;
        }
        const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

        setSaving(true);
        try {
            const url = mode === 'create' ? '/api/blog' : `/api/blog/${postId}`;
            const method = mode === 'create' ? 'POST' : 'PATCH';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    content,
                    category: category.trim() || null,
                    tags,
                    published_at: publishedAt,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || '儲存失敗');
            }

            const data = await res.json();
            toast({ title: mode === 'create' ? '已建立文章' : '已更新文章' });

            const targetId = mode === 'create' ? data.id : postId;
            router.push(`/blog/${targetId}`);
        } catch (err: any) {
            toast({ variant: 'destructive', title: '儲存失敗', description: err.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="container mx-auto py-10 max-w-5xl">
            <div className="flex items-center justify-between mb-6">
                <Button variant="ghost" onClick={() => router.back()} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    返回
                </Button>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => router.back()} disabled={saving}>
                        <X className="h-4 w-4 mr-2" />
                        取消
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        {mode === 'create' ? '建立文章' : '儲存變更'}
                    </Button>
                </div>
            </div>

            <div className="rounded-md border bg-card text-card-foreground shadow-sm p-6 space-y-5">
                <div className="grid gap-2">
                    <Label htmlFor="title">標題</Label>
                    <Input
                        id="title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="文章標題"
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="published">發布日期</Label>
                        <Input
                            id="published"
                            type="date"
                            value={publishedAt}
                            onChange={(e) => setPublishedAt(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="category">分類</Label>
                        <Input
                            id="category"
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            placeholder="例：選擇權策略"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="tags">標籤（以逗號分隔）</Label>
                        <Input
                            id="tags"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="例：Theta, 賣方, SPY"
                        />
                    </div>
                </div>

                <div className="grid gap-2">
                    <Label>內容 (Markdown)</Label>
                    <div data-color-mode={theme}>
                        <MDEditor
                            value={content}
                            onChange={(val) => setContent(val || '')}
                            height={600}
                            preview="live"
                            textareaProps={{
                                placeholder: '貼上或撰寫 Markdown 文章內容...',
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
