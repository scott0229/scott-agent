'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EditItemDialog } from '@/components/EditItemDialog';


import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const Markdown = dynamic(
  () => import('@uiw/react-md-editor').then((mod) => mod.default.Markdown),
  { ssr: false }
);

interface Item {
  id: number;
  project_id: number;
  title: string;
  content: string | null;
  status: string;
  milestone_id: number | null;
  assignee_id: number | null;
  created_at: number;
  updated_at: number;
  creator_email?: string;
  creator_avatar?: string;
  updater_email?: string;
  updater_avatar?: string;
  created_by: number;
  updated_by?: number;
}

interface Milestone {
  id: number;
  title: string;
}



export default function ItemDetailPage({
  params
}: {
  params: { id: string; itemId: string }
}) {
  const [item, setItem] = useState<Item | null>(null);

  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [editItemOpen, setEditItemOpen] = useState(false);


  const router = useRouter();

  const fetchData = useCallback(async () => {
    try {
      const [itemRes, milestonesRes] = await Promise.all([
        fetch(`/api/projects/${params.id}/items/${params.itemId}`),
        fetch(`/api/projects/${params.id}/milestones`)
      ]);

      const itemData = await itemRes.json();
      const milestonesData = await milestonesRes.json();

      if (itemData.success) {
        setItem(itemData.item);
      }

      if (milestonesData.success) {
        setMilestones(milestonesData.milestones);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, params.itemId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const currentMilestone = milestones.find(m => m.id === item?.milestone_id);

  const statusColors = {
    'New': 'bg-blue-100 text-blue-800',
    'In Progress': 'bg-yellow-100 text-yellow-800',
    'Closed': 'bg-green-100 text-green-800',
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">載入中...</div>;
  }

  if (!item) {
    return <div className="min-h-screen flex items-center justify-center">找不到任務</div>;
  }

  return (
    <div className="min-h-screen p-8 bg-background pb-32">
      <div className="w-full mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => router.push(`/project/${params.id}`)}>
            ← 返回專案
          </Button>
        </div>

        {/* Main Item Card */}
        <Card className="bg-white/90 backdrop-blur-sm shadow-lg overflow-hidden border-l-4 border-l-primary">
          <CardHeader className="border-b bg-secondary/10 pb-4">
            <div className="flex justify-between items-start">
              <div className="space-y-4 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                    #{item.id}
                  </Badge>
                  <h1 className="text-2xl font-bold text-foreground">{item.title}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Badge variant="secondary" className={`text-sm px-3 py-1 ${statusColors[item.status as keyof typeof statusColors]}`}>
                    {item.status}
                  </Badge>
                  {currentMilestone && (
                    <Badge variant="outline" className="text-sm px-3 py-1 flex gap-1">
                      🎯 {currentMilestone.title}
                    </Badge>
                  )}
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={item.creator_avatar} />
                      <AvatarFallback>{item.creator_email?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span>{item.creator_email} 建立於 {formatDate(item.created_at)}</span>
                  </div>
                  {(item.updated_at > item.created_at || item.updated_by) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                        編輯於: {formatDate(item.updated_at)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <Button onClick={() => setEditItemOpen(true)} variant="outline" size="sm">
                編輯
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6 min-h-[200px]">
            <div data-color-mode="light">
              <Markdown
                source={item.content || '*無描述*'}
                style={{ backgroundColor: 'transparent', color: 'inherit' }}
              />
            </div>
          </CardContent>
        </Card>




      </div>

      {/* Dialogs */}
      {item && (
        <EditItemDialog
          projectId={Number(params.id)}
          item={item}
          open={editItemOpen}
          onOpenChange={setEditItemOpen}
          onSuccess={fetchData}
        />
      )}


    </div>
  );
}
