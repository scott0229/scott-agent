'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import dynamic from 'next/dynamic';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const MDEditor = dynamic(
  () => import('@uiw/react-md-editor'),
  { ssr: false }
);

interface Item {
  id: number;
  title: string;
  content: string | null;
  status: string;
  milestone_id: number | null;
  assignee_id: number | null;
}

interface EditItemDialogProps {
  projectId: number;
  item: Item;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditItemDialog({ projectId, item, open, onOpenChange, onSuccess }: EditItemDialogProps) {
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content || '');
  const [status, setStatus] = useState(item.status);
  const [assigneeId, setAssigneeId] = useState<string>(item.assignee_id?.toString() || 'none');
  const [assignees, setAssignees] = useState<{ id: number, email: string, user_id: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTitle(item.title);
      setContent(item.content || '');
      setStatus(item.status);
      setAssigneeId(item.assignee_id?.toString() || 'none');
      fetchAssignees();
    }
  }, [open, item, projectId]);



  const fetchAssignees = async () => {
    try {
      const res = await fetch('/api/users?mode=selection&roles=admin,trader');
      const data = await res.json();
      if (data.users) {
        setAssignees(data.users.filter((u: any) => u.email !== 'admin'));
      }
    } catch (error) {
      console.error('Failed to fetch assignees:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/projects/${projectId}/items/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content,
          status,
          assigneeId: assigneeId === 'none' ? null : Number(assigneeId)
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update item');
      }

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>編輯任務</DialogTitle>

        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">標題</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="任務標題"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="status">狀態</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇狀態" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="New">新建</SelectItem>
                    <SelectItem value="In Progress">進行中</SelectItem>
                    <SelectItem value="Closed">已關閉</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assignee">指派給</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇成員" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未指派</SelectItem>
                    {assignees.map((user) => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.user_id || user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="content">描述</Label>
              <div data-color-mode="light">
                <MDEditor
                  value={content}
                  onChange={(val) => setContent(val || '')}
                  height={250}
                  preview="live"
                  textareaProps={{
                    placeholder: '任務描述... (支援 Markdown)'
                  }}
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-500 font-medium text-center bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? '儲存中...' : '儲存變更'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
