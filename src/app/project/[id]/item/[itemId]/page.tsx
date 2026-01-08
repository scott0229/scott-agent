'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const MDEditor = dynamic(
  () => import('@uiw/react-md-editor'),
  { ssr: false }
);

interface Item {
  id: number;
  project_id: number;
  title: string;
  content: string | null;
}

export default function ItemDetailPage({ 
  params 
}: { 
  params: { id: string; itemId: string } 
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchItem = async () => {
      try {
        const res = await fetch(
          `/api/projects/${params.id}/items/${params.itemId}`
        );
        const data = await res.json() as { success: boolean; item: Item };
        if (data.success) {
          setItem(data.item);
          setTitle(data.item.title);
          setContent(data.item.content || '');
        }
      } catch (error) {
        console.error('Failed to fetch item:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchItem();
  }, [params.id, params.itemId]);

  const handleSave = useCallback(async () => {
    if (!item) return;
    
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${params.id}/items/${params.itemId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        }
      );
      
      if (res.ok) {
        setLastSaved(new Date());
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [item, title, content, params.id, params.itemId]);

  // Auto-save on content change (debounced)
  useEffect(() => {
    if (!item) return;
    
    const timer = setTimeout(() => {
      handleSave();
    }, 2000);

    return () => clearTimeout(timer);
  }, [content, title, handleSave, item]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!item) {
    return <div className="min-h-screen flex items-center justify-center">Item not found</div>;
  }

  return (
    <div className="min-h-screen p-8 bg-background">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={() => router.push(`/project/${params.id}`)}>
            ← Back to Project
          </Button>
          <div className="flex items-center gap-4">
            {lastSaved && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved at {lastSaved.toLocaleTimeString()}
              </span>
            )}
            <Button onClick={handleSave} disabled={isSaving} className="bg-primary hover:bg-primary/90">
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        {/* Editor Card */}
        <Card className="bg-white/90 backdrop-blur-sm shadow-lg">
          <CardHeader className="pb-0">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-2xl font-bold border-none shadow-none focus-visible:ring-0 px-0 placeholder:text-muted-foreground/50"
              placeholder="Enter item title..."
            />
          </CardHeader>
          <CardContent className="pt-4">
            <div data-color-mode="light" className="min-h-[500px]">
              <MDEditor
                value={content}
                onChange={(val) => setContent(val || '')}
                height={500}
                preview="live"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

