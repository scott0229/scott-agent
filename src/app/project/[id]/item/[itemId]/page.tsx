'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";

import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const MDEditor = dynamic(
  () => import('@uiw/react-md-editor'),
  { ssr: false }
);

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
  
  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<string>('');
  const [status, setStatus] = useState('');
  const [milestoneId, setMilestoneId] = useState<string>('none');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
        setTitle(itemData.item.title);
        setContent(itemData.item.content || '');
        setStatus(itemData.item.status);
        setMilestoneId(itemData.item.milestone_id?.toString() || 'none');
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${params.id}/items/${params.itemId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            title, 
            content,
            status,
            milestoneId: milestoneId === 'none' ? null : Number(milestoneId)
          }),
        }
      );
      
      if (res.ok) {
        await fetchData(); // Refresh data
        setIsEditing(false); // Exit edit mode
      }
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

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
            {isEditing ? (
              <>
                <Button variant="outline" onClick={() => {
                  setIsEditing(false);
                  // Reset fields
                  setTitle(item.title);
                  setContent(item.content || '');
                  setStatus(item.status);
                  setMilestoneId(item.milestone_id?.toString() || 'none');
                }}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setIsEditing(true)}>
                Edit Item
              </Button>
            )}
          </div>
        </div>

        {/* Content Card */}
        <Card className="bg-white/90 backdrop-blur-sm shadow-lg overflow-hidden">
          <CardHeader className="border-b bg-secondary/20 pb-6">
            {isEditing ? (
              <div className="space-y-4">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-2xl font-bold h-auto py-2"
                  placeholder="Item title"
                />
                <div className="flex gap-4">
                  <div className="w-48">
                    <Label htmlFor="status" className="mb-2 block text-xs font-semibold text-muted-foreground uppercase">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="New">New</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                        <SelectItem value="Closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-48">
                    <Label htmlFor="milestone" className="mb-2 block text-xs font-semibold text-muted-foreground uppercase">Milestone</Label>
                    <Select value={milestoneId} onValueChange={setMilestoneId}>
                      <SelectTrigger className="bg-white">
                        <SelectValue placeholder="Select milestone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {milestones.map((m) => (
                          <SelectItem key={m.id} value={m.id.toString()}>
                            {m.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <h1 className="text-3xl font-bold text-foreground">{item.title}</h1>
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
                <div className="flex items-center gap-6 text-sm text-muted-foreground mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={item.creator_avatar} />
                      <AvatarFallback>{item.creator_email?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span>Created by {item.creator_email} on {formatDate(item.created_at)}</span>
                  </div>
                  {(item.updated_at > item.created_at || item.updated_by) && (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={item.updater_avatar} />
                        <AvatarFallback>{item.updater_email?.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span>Updated by {item.updater_email} on {formatDate(item.updated_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="pt-6">
            {isEditing ? (
              <div data-color-mode="light" className="min-h-[500px]">
                <MDEditor
                  value={content}
                  onChange={(val) => setContent(val || '')}
                  height={500}
                  preview="live"
                  textareaProps={{
                    placeholder: 'Write your item content here... (Markdown supported)'
                  }}
                />
              </div>
            ) : (
              <div data-color-mode="light">
                <Markdown 
                  source={item.content || '*No content provided*'} 
                  style={{ backgroundColor: 'transparent', color: 'inherit' }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
