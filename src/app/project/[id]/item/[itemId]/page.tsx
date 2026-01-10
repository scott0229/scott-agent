'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EditItemDialog } from '@/components/EditItemDialog';
import { CommentDialog } from '@/components/CommentDialog';

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

interface Comment {
  id: number;
  content: string;
  created_at: number;
  updated_at: number | null;
  creator_email?: string;
  creator_avatar?: string;
  created_by: number;
}

export default function ItemDetailPage({
  params
}: {
  params: { id: string; itemId: string }
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Dialog states
  const [editItemOpen, setEditItemOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [editingComment, setEditingComment] = useState<Comment | undefined>(undefined);

  const router = useRouter();

  const fetchData = useCallback(async () => {
    try {
      const [itemRes, milestonesRes, commentsRes] = await Promise.all([
        fetch(`/api/projects/${params.id}/items/${params.itemId}`),
        fetch(`/api/projects/${params.id}/milestones`),
        fetch(`/api/projects/${params.id}/items/${params.itemId}/comments`)
      ]);

      const itemData = await itemRes.json();
      const milestonesData = await milestonesRes.json();
      const commentsData = await commentsRes.json();

      if (itemData.success) {
        setItem(itemData.item);
      }

      if (milestonesData.success) {
        setMilestones(milestonesData.milestones);
      }

      if (commentsData.success) {
        setComments(commentsData.comments);
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

        {/* Comments Stream */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground ml-2">討論區</h2>

          {comments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground bg-secondary/5 rounded-lg border border-dashed text-sm">
              尚無留言。開始討論吧！
            </div>
          ) : (
            comments.map((comment) => (
              <Card key={comment.id} className="bg-white/80 hover:bg-white/95 transition-colors shadow-sm">
                <CardHeader className="py-3 px-6 border-b flex flex-row items-center justify-between bg-muted/10">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={comment.creator_avatar} />
                      <AvatarFallback>{comment.creator_email?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold">{comment.creator_email}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(comment.created_at)}</span>
                    </div>
                  </div>

                  {/* TODO: Add check for current user ownership */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingComment(comment);
                      setCommentOpen(true);
                    }}
                  >
                    編輯
                  </Button>
                </CardHeader>
                <CardContent className="py-4 px-6 text-sm">
                  <div data-color-mode="light">
                    <Markdown
                      source={comment.content}
                      style={{ backgroundColor: 'transparent', color: 'inherit', fontSize: '0.95rem' }}
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Floating Action Button for Reply */}
        <div className="fixed bottom-8 right-8">
          <Button
            size="lg"
            className="shadow-xl rounded-full px-6 h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-lg"
            onClick={() => {
              setEditingComment(undefined);
              setCommentOpen(true);
            }}
          >
            💬 回覆
          </Button>
        </div>
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

      <CommentDialog
        projectId={Number(params.id)}
        itemId={Number(params.itemId)}
        comment={editingComment}
        open={commentOpen}
        onOpenChange={setCommentOpen}
        onSuccess={fetchData}
      />
    </div>
  );
}
