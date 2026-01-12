'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EditProjectDialog } from "@/components/EditProjectDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface User {
  id: number;
  email: string;
  user_id: string | null;
  avatar_url: string | null;
  role?: string;
}

interface Project {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_at: number;
  owner_user_id: string | null;
  owner_email: string | null;
  task_count?: number;
}

const ITEMS_PER_PAGE = 10;

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
  const paginatedProjects = projects.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
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

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json() as { success: boolean; user: User };
      if (data.success) {
        setUser(data.user);
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchUser();
  }, []);

  const handleDelete = (id: number) => {
    setProjectToDelete(id);
  };

  const confirmDelete = async () => {
    if (!projectToDelete) return;

    try {
      const res = await fetch(`/api/projects/${projectToDelete}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(projects.filter(p => p.id !== projectToDelete));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setProjectToDelete(null);
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setEditDialogOpen(true);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen container mx-auto py-10">
        <div className="w-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground">專案列表</h1>
            </div>
            <div className="flex gap-4">
              {/* Only admin and manager can create projects */}
              {(user?.role === 'admin' || user?.role === 'manager') && (
                <Button
                  onClick={() => setDialogOpen(true)}
                  variant="secondary"
                  className="hover:bg-accent hover:text-accent-foreground"
                >
                  + 新增專案
                </Button>
              )}
            </div>
          </div>

          {/* Projects List */}
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">載入中...</div>
          ) : projects.length === 0 ? (
            <Card className="text-center py-12 bg-white/80">
              <CardContent>
                <div className="text-muted-foreground mb-4">
                  <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  {(user?.role === 'admin' || user?.role === 'manager') ? (
                    <p className="text-lg">建立您的第一個專案以開始使用</p>
                  ) : (
                    <p className="text-lg">目前沒有可用的專案</p>
                  )}
                </div>
                {/* Only admin and manager can create projects */}
                {(user?.role === 'admin' || user?.role === 'manager') && (
                  <Button onClick={() => setDialogOpen(true)}>建立專案</Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary hover:bg-secondary">
                    <TableHead className="w-[50px] text-center">#</TableHead>
                    <TableHead>專案名稱</TableHead>
                    <TableHead className="text-center">任務數量</TableHead>
                    <TableHead>建立時間</TableHead>
                    <TableHead>擁有者</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProjects.map((project, index) => (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/project/${project.id}`)}
                    >
                      <TableCell className="text-center text-muted-foreground font-mono">
                        {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium text-foreground">
                            {project.name}
                          </span>

                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center min-w-[30px] px-2 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded-full">
                          {project.task_count || 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(project.created_at * 1000).toLocaleDateString('zh-TW', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        {project.user_id === user?.id ? (
                          <div className="w-fit px-2 py-0.5 rounded-full bg-primary/10 flex items-center justify-center text-xs text-primary font-medium">
                            你
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {project.owner_user_id || project.owner_email || '未知'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Only admin and manager can edit/delete projects */}
                        {(user?.role === 'admin' || user?.role === 'manager') && (
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(project);
                                  }}
                                  className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>編輯</p>
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(project.id);
                                  }}
                                  className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>刪除</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-sm text-muted-foreground">
                    顯示 {(currentPage - 1) * ITEMS_PER_PAGE + 1} 到 {Math.min(currentPage * ITEMS_PER_PAGE, projects.length)} 筆，共 {projects.length} 筆專案
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => p - 1)}
                    >
                      上一頁
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
                      下一頁
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <NewProjectDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSuccess={() => {
              router.refresh();
              fetchProjects();
            }}
          />
          <EditProjectDialog
            project={editingProject}
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            onSuccess={fetchProjects}
          />

          <AlertDialog open={!!projectToDelete} onOpenChange={(open: boolean) => !open && setProjectToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>您確定要刪除嗎？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作無法復原。這將永久刪除此專案。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete}>
                  刪除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </TooltipProvider>
  );
}
