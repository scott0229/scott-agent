'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BlogEditor, BlogEditorInitial } from '@/components/BlogEditor';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function EditBlogPostPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { toast } = useToast();
    const postId = parseInt(params.id, 10);
    const [initial, setInitial] = useState<BlogEditorInitial | null>(null);
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
                    setInitial({
                        title: data.post.title,
                        content: data.post.content,
                        category: data.post.category,
                        tags: data.post.tags,
                        published_at: data.post.published_at,
                    });
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

    if (!initial) return null;

    return <BlogEditor mode="edit" postId={postId} initial={initial} />;
}
