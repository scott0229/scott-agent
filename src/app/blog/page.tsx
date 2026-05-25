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
    const [category, setCategory] = useState<string>('All');

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
                            <Link key={post.id} href={`/blog/${post.id}`}>
                                <div className={`rounded-md border shadow-sm p-5 h-full flex flex-col gap-3 hover:shadow-md transition-all cursor-pointer text-card-foreground ${categoryStyle}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <h2 className="font-semibold text-lg leading-snug line-clamp-2">{post.title}</h2>
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
                                    {post.tags.length > 0 && (
                                        <div className="flex items-center gap-1.5 flex-wrap mt-auto">
                                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                                            {post.tags.map(t => (
                                                <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
