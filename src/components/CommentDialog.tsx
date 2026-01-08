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
import { Label } from "@/components/ui/label";
import dynamic from 'next/dynamic';

import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

const MDEditor = dynamic(
  () => import('@uiw/react-md-editor'),
  { ssr: false }
);

interface Comment {
  id: number;
  content: string;
}

interface CommentDialogProps {
  projectId: number;
  itemId: number;
  comment?: Comment; // If provided, edit mode. If not, create mode.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CommentDialog({ projectId, itemId, comment, open, onOpenChange, onSuccess }: CommentDialogProps) {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const isEditing = !!comment;

  useEffect(() => {
    if (open) {
      setContent(comment?.content || '');
      setError('');
    }
  }, [open, comment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const url = isEditing
        ? `/api/projects/${projectId}/items/${itemId}/comments/${comment.id}`
        : `/api/projects/${projectId}/items/${itemId}/comments`;
      
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save comment');
      }

      onSuccess();
      onOpenChange(false);
      if (!isEditing) setContent('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Comment' : 'Add Comment'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update your comment below.' : 'Share your thoughts or updates.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <div data-color-mode="light">
                <MDEditor
                  value={content}
                  onChange={(val) => setContent(val || '')}
                  height={300}
                  preview="live"
                  textareaProps={{
                    placeholder: 'Write your comment... (Markdown supported)'
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
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : (isEditing ? 'Update' : 'Post Reply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
