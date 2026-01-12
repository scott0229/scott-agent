'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


interface Project {
  id: number;
  name: string;
  description: string | null;
  avatar_url: string | null;
}

interface EditProjectDialogProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface User {
  id: number;
  email: string;
  user_id: string | null;
  role: string;
}

export function EditProjectDialog({ project, open, onOpenChange, onSuccess }: EditProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Fetch users and assigned users when dialog opens
  useEffect(() => {
    if (open && project) {
      fetchUsers();
      fetchAssignedUsers(project.id);
    }
  }, [open, project]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users?mode=selection&roles=customer,trader');
      const data = await res.json();
      if (data.users) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const fetchAssignedUsers = async (projectId: number) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/users`);
      const data = await res.json();
      if (data.users) {
        setSelectedUserIds(data.users.map((u: User) => u.id));
      }
    } catch (error) {
      console.error('Failed to fetch assigned users:', error);
    }
  };

  const handleUserToggle = (userId: number) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
    }
  }, [project]);



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    setError('');

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    setIsLoading(true);

    try {
      // Update project
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, userIds: selectedUserIds }),
      });

      const data = await res.json() as { success: boolean; error?: string };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update project');
      }

      onSuccess();
      onOpenChange(false);

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (!project) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>編輯專案</DialogTitle>
          <DialogDescription>
            更新您的專案資訊。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">專案名稱 *</Label>
              <Input
                id="name"
                placeholder="我的精彩專案"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">描述</Label>
              <Input
                id="description"
                placeholder="專案簡述"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* User Assignment */}
            <div className="grid gap-2">
              <Label>權限設定</Label>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                {users.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">無可用使用者</p>
                ) : (
                  users.map(user => (
                    <label key={user.id} className="flex items-center space-x-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded">
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => handleUserToggle(user.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm">
                        {user.user_id || user.email} ({user.role === 'customer' ? '客戶' : '交易員'})
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selectedUserIds.length > 0 && (
                <p className="text-xs text-muted-foreground">已選擇 {selectedUserIds.length} 位使用者</p>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-500 font-medium text-center bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
