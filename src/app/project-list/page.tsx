'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EditProjectDialog } from "@/components/EditProjectDialog";

interface Project {
  id: number;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_at: number;
}

const ITEMS_PER_PAGE = 10;

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
  const paginatedProjects = projects.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json() as { success: boolean; projects: Project[] };
      if (data.success) {
        setProjects(data.projects);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(projects.filter(p => p.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleEdit = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditDialogOpen(true);
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">My Projects</h1>
            <p className="text-muted-foreground mt-1">Manage your projects and items</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-primary hover:bg-primary/90">
            + New Project
          </Button>
        </div>

        {/* Projects List */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : projects.length === 0 ? (
          <Card className="text-center py-12 bg-white/80">
            <CardContent>
              <div className="text-muted-foreground mb-4">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-lg">No projects yet</p>
                <p className="text-sm mt-1">Create your first project to get started</p>
              </div>
              <Button onClick={() => setDialogOpen(true)}>Create Project</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/30 border-b text-sm font-medium text-muted-foreground">
              <div className="col-span-1"></div>
              <div className="col-span-4">Project</div>
              <div className="col-span-3">Created</div>
              <div className="col-span-2">Owner</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            {/* Table Body */}
            <div className="divide-y">
              {paginatedProjects.map((project) => (
                <div 
                  key={project.id} 
                  className="grid grid-cols-12 gap-4 px-4 py-4 hover:bg-primary/5 cursor-pointer transition-colors items-center group"
                  onClick={() => router.push(`/project/${project.id}`)}
                >
                  <div className="col-span-1">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={project.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {project.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="col-span-4">
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {project.name}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {project.description || 'No description'}
                    </p>
                  </div>
                  <div className="col-span-3 text-sm text-muted-foreground">
                    {new Date(project.created_at * 1000).toLocaleDateString('zh-TW', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-medium">
                      Y
                    </div>
                    You
                  </div>
                  <div className="col-span-2 text-right flex items-center justify-end gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleEdit(project, e)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDelete(project.id, e)}
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
                  Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, projects.length)} of {projects.length} projects
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

        <NewProjectDialog 
          open={dialogOpen} 
          onOpenChange={setDialogOpen}
          onSuccess={fetchProjects}
        />
        <EditProjectDialog 
          project={editingProject}
          open={editDialogOpen} 
          onOpenChange={setEditDialogOpen}
          onSuccess={fetchProjects}
        />
      </div>
    </div>
  );
}
