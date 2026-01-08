'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Project {
  id: number;
  name: string;
  description: string | null;
  avatar_url: string | null;
}

interface Item {
  id: number;
  project_id: number;
  title: string;
  content: string | null;
  created_at: number;
  updated_at: number;
}

const ITEMS_PER_PAGE = 10;

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const paginatedItems = items.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const fetchData = async () => {
    try {
      const [projectRes, itemsRes] = await Promise.all([
        fetch(`/api/projects/${params.id}`),
        fetch(`/api/projects/${params.id}/items`),
      ]);
      
      const projectData = await projectRes.json() as { success: boolean; project: Project };
      const itemsData = await itemsRes.json() as { success: boolean; items: Item[] };
      
      if (projectData.success) setProject(projectData.project);
      if (itemsData.success) setItems(itemsData.items);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [params.id]);

  const handleCreateItem = async () => {
    setIsCreating(true);
    try {
      // Create a new item with default title
      const res = await fetch(`/api/projects/${params.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled', content: '' }),
      });
      
      const data = await res.json() as { success: boolean; item: Item };
      if (data.success) {
        // Navigate to edit page
        router.push(`/project/${params.id}/item/${data.item.id}`);
      }
    } catch (error) {
      console.error('Failed to create item:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (!confirm('Delete this item?')) return;

    try {
      const res = await fetch(`/api/projects/${params.id}/items/${itemId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems(items.filter(i => i.id !== itemId));
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center">Project not found</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => router.push('/project-list')} className="mb-6">
          ← Back to Projects
        </Button>

        {/* Project Header Card */}
        <Card className="mb-8 bg-white/90 backdrop-blur-sm shadow-lg">
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 ring-2 ring-primary/20">
                <AvatarImage src={project.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                  {project.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-foreground">{project.name}</h1>
                <p className="text-muted-foreground mt-1">{project.description || 'No description'}</p>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Items Section */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Items</h2>
          <Button 
            onClick={handleCreateItem} 
            disabled={isCreating}
            className="bg-primary hover:bg-primary/90"
          >
            {isCreating ? 'Creating...' : '+ Create Item'}
          </Button>
        </div>

        {/* Items List */}
        {items.length === 0 ? (
          <Card className="text-center py-12 bg-white/80">
            <CardContent>
              <div className="text-muted-foreground mb-4">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-lg">No items yet</p>
                <p className="text-sm mt-1">Create your first item to get started</p>
              </div>
              <Button onClick={handleCreateItem} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create First Item'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-secondary border-b text-sm font-medium text-muted-foreground">
              <div className="col-span-5">Title</div>
              <div className="col-span-3">Created</div>
              <div className="col-span-2">Owner</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            {/* Table Body */}
            <div className="divide-y">
              {paginatedItems.map((item) => (
                <div 
                  key={item.id} 
                  className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-primary/5 cursor-pointer transition-colors items-center group"
                  onClick={() => router.push(`/project/${params.id}/item/${item.id}`)}
                >
                  <div className="col-span-5">
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.title || 'Untitled'}
                    </span>
                    {item.content && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.content.substring(0, 60)}...
                      </p>
                    )}
                  </div>
                  <div className="col-span-3 text-sm text-muted-foreground">
                    {formatDate(item.created_at)}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-medium">
                      Y
                    </div>
                    You
                  </div>
                  <div className="col-span-2 text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item.id);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
                <span className="text-sm text-muted-foreground">
                  Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, items.length)} of {items.length} items
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

