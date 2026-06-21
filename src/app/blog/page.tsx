'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Search, BookOpen, CalendarDays, Tag } from 'lucide-react';

const CATEGORY_OPTIONS = ['案例', '影片', '文檔'] as const;

interface BlogPostSummary {
    id: number;
    title: string;
    category: string | null;
    tags: string[];
    published_at: string;
    created_at: number;
    updated_at: number;
    video_url: string | null;
}

// Per-category card tint. Subtle dark-mode-friendly background + border
// so the three content types (案例 / 影片 / 文檔) are visually distinct
// at a glance. Falls back to the default card surface for any other
// category.
const getCategoryCardStyle = (category: string | null): string => {
    switch (category) {
        case '案例':
            return 'bg-emerald-900/40 border-emerald-700/70 hover:border-emerald-500';
        case '影片':
            return 'bg-indigo-900/40 border-indigo-700/70 hover:border-indigo-500';
        case '文檔':
            return 'bg-amber-900/40 border-amber-700/70 hover:border-amber-500';
        default:
            return 'bg-card hover:border-primary/40';
    }
};

export default function BlogListPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [posts, setPosts] = useState<BlogPostSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    // Persist the category filter across navigation (click into a post → back)
    // via sessionStorage so it doesn't reset to 'All' on remount.
    const [category, setCategory] = useState<string>(() => {
        if (typeof window === 'undefined') return 'All';
        return sessionStorage.getItem('blog-category-filter') || 'All';
    });
    useEffect(() => {
        if (typeof window !== 'undefined') sessionStorage.setItem('blog-category-filter', category);
    }, [category]);
    // Inline title edit: double-click a card title to rename without opening it.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editValue, setEditValue] = useState('');

    const saveTitle = async (id: number) => {
        const title = editValue.trim();
        const original = posts.find(p => p.id === id)?.title;
        setEditingId(null);
        if (!title || title === original) return;
        // Optimistic update.
        setPosts(prev => prev.map(p => p.id === id ? { ...p, title } : p));
        try {
            const res = await fetch(`/api/blog/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            });
            if (!res.ok) throw new Error('save failed');
            toast({ title: '已更新標題' });
        } catch {
            // Revert on failure.
            setPosts(prev => prev.map(p => p.id === id ? { ...p, title: original ?? p.title } : p));
            toast({ variant: 'destructive', title: '更新失敗', description: '無法儲存標題' });
        }
    };

    // Cycle the difficulty tag (基礎/進階) on a post: none → 基礎 → 進階 → none.
    // Difficulty lives in the tags array; we strip any existing one and add the
    // next, then PATCH the full tag list.
    const cycleDifficulty = async (id: number) => {
        const post = posts.find(p => p.id === id);
        if (!post) return;
        const order = [null, '基礎', '進階'] as const;
        const current = post.tags.find(t => t === '基礎' || t === '進階') ?? null;
        const next = order[(order.indexOf(current as typeof order[number]) + 1) % order.length];
        const baseTags = post.tags.filter(t => t !== '基礎' && t !== '進階');
        const newTags = next ? [...baseTags, next] : baseTags;
        const prevTags = post.tags;
        setPosts(prev => prev.map(p => p.id === id ? { ...p, tags: newTags } : p));
        try {
            const res = await fetch(`/api/blog/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: newTags }),
            });
            if (!res.ok) throw new Error('save failed');
        } catch {
            setPosts(prev => prev.map(p => p.id === id ? { ...p, tags: prevTags } : p));
            toast({ variant: 'destructive', title: '更新失敗', description: '無法儲存難度' });
        }
    };

    const fetchPosts = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/blog');
            if (res.status === 403) {
                toast({ variant: 'destructive', title: '權限不足', description: '您沒有權限訪問此頁面' });
                router.push('/');
                return;
            }
            if (res.ok) {
                const data = await res.json();
                setPosts(data.posts || []);
            }
        } catch (err) {
            console.error('Fetch posts failed:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPosts();
    }, []);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return posts.filter(p => {
            if (category !== 'All' && p.category !== category) return false;
            if (!s) return true;
            if (p.title.toLowerCase().includes(s)) return true;
            if (p.tags.some(t => t.toLowerCase().includes(s))) return true;
            return false;
        });
    }, [posts, search, category]);

    return (
        <div className="container mx-auto py-10">
            <div className="flex justify-between items-center mb-6 gap-4 flex-wrap">
                <h1 className="text-3xl font-bold flex items-center gap-2">
                    <BookOpen className="h-7 w-7" />
                    部落格
                </h1>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="搜尋標題或標籤..."
                            className="pl-9 w-[240px]"
                        />
                    </div>
                    <div className="inline-flex h-9 rounded-md border bg-card overflow-hidden">
                        {CATEGORY_OPTIONS.map((cat, idx) => {
                            const isActive = category === cat;
                            return (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setCategory(isActive ? 'All' : cat)}
                                    className={cn(
                                        'px-4 text-sm font-medium transition-colors',
                                        isActive
                                            ? 'bg-primary text-primary-foreground'
                                            : 'hover:bg-accent hover:text-accent-foreground',
                                        idx > 0 && 'border-l',
                                    )}
                                >
                                    {cat}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="rounded-md border bg-card text-card-foreground shadow-sm p-8 text-center text-muted-foreground">
                    載入中...
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-md border bg-card text-card-foreground shadow-sm p-12 text-center text-muted-foreground">
                    {posts.length === 0 ? '尚無文章。' : '沒有符合條件的文章。'}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filtered.map(post => {
                        const categoryStyle = getCategoryCardStyle(post.category);
                        return (
                            // Card is a flex row: Link-wrapped text on the left, an
                            // inline video preview on the right (outside the Link so
                            // pressing play never navigates to the post).
                            <div key={post.id} className={`rounded-md border shadow-sm p-5 h-[150px] flex flex-row gap-4 hover:shadow-md transition-all text-card-foreground ${categoryStyle}`}>
                                <Link href={`/blog/${post.id}`} className="flex-1 min-w-0 flex flex-col gap-3 cursor-pointer">
                                    <div className="flex items-start justify-between gap-2">
                                        {editingId === post.id ? (
                                            <input
                                                type="text"
                                                value={editValue}
                                                autoFocus
                                                // autoFocus lands the caret at the end; move it to
                                                // the start AND reset the horizontal scroll so the
                                                // beginning of a long title is actually visible.
                                                onFocus={(e) => {
                                                    const el = e.currentTarget;
                                                    el.setSelectionRange(0, 0);
                                                    el.scrollLeft = 0;
                                                }}
                                                // Stop the Link navigation while editing.
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                onBlur={() => saveTitle(post.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') { e.preventDefault(); saveTitle(post.id); }
                                                    else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                                                }}
                                                className="w-full bg-transparent border-b border-primary/60 font-semibold text-lg leading-snug focus:outline-none"
                                            />
                                        ) : (
                                            <h2
                                                className="font-semibold text-lg leading-snug line-clamp-2"
                                                title="雙擊以修改標題"
                                                // Block single-click navigation on the title itself —
                                                // otherwise the first click of a double-click opens the
                                                // post before the dblclick can register. Click the date/
                                                // tag area to open the post; double-click here to rename.
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                onDoubleClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setEditValue(post.title);
                                                    setEditingId(post.id);
                                                }}
                                            >
                                                {post.title}
                                            </h2>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                            <CalendarDays className="h-3.5 w-3.5" />
                                            {post.published_at}
                                        </span>
                                        {post.category && (
                                            <Badge variant="secondary" className="text-xs">{post.category}</Badge>
                                        )}
                                    </div>
                                    {(() => {
                                        // Only a clickable difficulty chip here — the 影片
                                        // category is already shown as a badge in the date
                                        // row, so we don't repeat it. Other tags stay hidden.
                                        const difficulty = post.tags.find(t => t === '基礎' || t === '進階') ?? null;
                                        // Color the difficulty chip: 基礎 green, 進階 amber,
                                        // unset muted. Click cycles it.
                                        const diffClass = difficulty === '基礎'
                                            ? 'bg-status-positive-soft text-status-positive border-status-positive-border'
                                            : difficulty === '進階'
                                                ? 'bg-note-badge text-note-badge-fg border-transparent'
                                                : 'bg-muted text-muted-foreground border-transparent';
                                        return (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                                            <button
                                                type="button"
                                                title="點擊切換難度"
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); cycleDifficulty(post.id); }}
                                                className={`text-xs px-2 py-0.5 rounded-full border font-medium ${diffClass}`}
                                            >
                                                {difficulty ?? '＋難度'}
                                            </button>
                                        </div>
                                        );
                                    })()}
                                </Link>
                                {post.video_url && (
                                    <video
                                        preload="metadata"
                                        src={post.video_url}
                                        // Controls only on hover (kept while playing) so the
                                        // resting card shows a clean thumbnail. self-start
                                        // anchors it top-right so it stays put regardless of
                                        // title length (fixed width keeps the title unsqueezed).
                                        onMouseEnter={(e) => { e.currentTarget.controls = true; }}
                                        onMouseLeave={(e) => { if (e.currentTarget.paused) e.currentTarget.controls = false; }}
                                        className="w-48 shrink-0 self-start rounded-md bg-black aspect-video object-cover"
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
