'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, CalendarDays } from 'lucide-react';

interface BlogPost {
    id: number;
    title: string;
    content: string;
    category: string | null;
    tags: string[];
    published_at: string;
    created_at: number;
    updated_at: number;
}

export default function BlogPostPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { toast } = useToast();
    const postId = parseInt(params.id, 10);
    const [post, setPost] = useState<BlogPost | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`/api/blog/${postId}`);
                if (res.status === 403) {
                    toast({ variant: 'destructive', title: '權限不足' });
                    router.push('/');
                    return;
                }
                if (res.status === 404) {
                    toast({ variant: 'destructive', title: '文章不存在' });
                    router.push('/blog');
                    return;
                }
                if (res.ok) {
                    const data = await res.json();
                    setPost(data.post);
                }
            } catch (err) {
                console.error('Load post failed:', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [postId, router, toast]);

    if (loading) {
        return (
            <div className="container mx-auto py-20 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin inline-block mr-2" />
                載入中...
            </div>
        );
    }

    if (!post) return null;

    return (
        <div className="container mx-auto py-10 max-w-4xl">
            <div className="mb-6">
                <Link href="/blog">
                    <Button variant="ghost" className="gap-2">
                        <ArrowLeft className="h-4 w-4" />
                        返回列表
                    </Button>
                </Link>
            </div>

            <article className="rounded-md border bg-card text-card-foreground shadow-sm p-8">
                <header className="mb-6 pb-6 border-b">
                    <h1 className="text-3xl font-bold leading-tight mb-3">{post.title}</h1>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                        <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-4 w-4" />
                            {post.published_at}
                        </span>
                        {post.category && (
                            <Badge variant="secondary">{post.category}</Badge>
                        )}
                        {post.tags.map(t => (
                            <Badge key={t} variant="outline">{t}</Badge>
                        ))}
                    </div>
                </header>

                <div
                    className="blog-content"
                    dangerouslySetInnerHTML={{ __html: post.content || '' }}
                />
            </article>
        </div>
    );
}
