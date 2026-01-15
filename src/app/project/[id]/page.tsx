'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewItemDialog } from "@/components/NewItemDialog";

import { EditItemDialog } from "@/components/EditItemDialog";
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
import { Pencil, Trash2, FilterX, ArrowLeft } from 'lucide-react';

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
  status: string;
  milestone_id: number | null;
  assignee_id: number | null;
  assignee_email?: string;
  assignee_user_id?: string;
  assignee_avatar?: string;
  created_at: number;
  updated_at: number;
  creator_email?: string;
  creator_user_id?: string;
  creator_avatar?: string;
}

interface Milestone {
  id: number;
  title: string;
  due_date: number | null;
}

const ITEMS_PER_PAGE = 10;

export default function ProjectDetailPage() {
  const params = useParams() as { id: string };
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [assignees, setAssignees] = useState<{ id: number, email: string, user_id: string | null }[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  // Dialog states
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);

  // Edit Dialog State
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);

  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  // Filter states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [milestoneFilter, setMilestoneFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  // Sort states
  const [sortBy, setSortBy] = useState<'created_at' | 'updated_at'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setAssigneeFilter('all');
  };

  const router = useRouter();

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const paginatedItems = items.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (search) queryParams.append('search', search);
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (milestoneFilter !== 'all') queryParams.append('milestoneId', milestoneFilter);
      if (assigneeFilter !== 'all') queryParams.append('assigneeId', assigneeFilter);
      queryParams.append('sort', sortBy);
      queryParams.append('order', sortOrder);

      const [projectRes, itemsRes] = await Promise.all([
        fetch(`/api/projects/${params.id}`),
        fetch(`/api/projects/${params.id}/items?${queryParams.toString()}`, { cache: 'no-store' }),
      ]);

      const projectData = await projectRes.json();
      const itemsData = await itemsRes.json();

      if (projectData.success) setProject(projectData.project);
      if (itemsData.success) setItems(itemsData.items);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAssignees = async () => {
    try {
      const res = await fetch(`/api/projects/${params.id}/members`);
      const data = await res.json();
      if (data.success && data.members) {
        setAssignees(data.members);
      }
    } catch (error) {
      console.error('Failed to fetch project members:', error);
    }
  };

  useEffect(() => {
    fetchAssignees();
    // Initial data fetch without debounce
    fetchData();
  }, []);

  useEffect(() => {
    // Skip on initial mount (already fetched above)
    if (!project) return;

    // Debounce search and filter changes
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter, milestoneFilter, assigneeFilter, sortBy, sortOrder]);

  const toggleSort = (column: 'created_at' | 'updated_at') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const handleEditItem = (item: Item) => {
    setEditingItem(item);
    setIsEditItemOpen(true);
  };

  const handleDeleteItem = (itemId: number) => {
    setItemToDelete(itemId);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      const res = await fetch(`/api/projects/${params.id}/items/${itemToDelete}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems(items.filter(i => i.id !== itemToDelete));
      }
    } catch (error) {
      console.error('Failed to delete item:', error);
    } finally {
      setItemToDelete(null);
    }
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp) return '-';
    // Format: 2026/1/8
    const date = new Date(timestamp * 1000);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  };

  const statusColors = {
    'New': 'bg-blue-100 text-blue-800', // Assuming these status keys are from DB, might need logic or just UI mapping if displayed
    'In Progress': 'bg-yellow-100 text-yellow-800',
    'Closed': 'bg-green-100 text-green-800',
  };

  if (!project && !isLoading) {
    if (!project && !isLoading) {
      return <div className="min-h-screen flex items-center justify-center">找不到專案</div>;
    }
  }

  const handleCreateSuccess = () => {
    setSearch('');
    setStatusFilter('all');
    setAssigneeFilter('all');
    fetchData();
  };

  return (
    <div className="container mx-auto py-10">
      <div className="w-full">
        {/* Project Header & Filters */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push('/project-list')}>
              <ArrowLeft className="h-6 w-6" />
            </Button>
            {project && (
              <h1 className="text-3xl font-bold text-foreground">{project.name}</h1>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-wrap gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={resetFilters}
                      className="h-10 w-10 text-muted-foreground hover:text-primary mr-2"
                    >
                      <FilterX className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>重置篩選</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Input
                placeholder="搜尋任務..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-[200px] h-10 bg-white"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] bg-white focus:ring-0 focus:ring-offset-0">
                  <SelectValue placeholder="依狀態篩選" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有狀態</SelectItem>
                  <SelectItem value="New">新建</SelectItem>
                  <SelectItem value="In Progress">進行中</SelectItem>
                  <SelectItem value="Closed">已關閉</SelectItem>
                </SelectContent>
              </Select>
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="w-[140px] bg-white focus:ring-0 focus:ring-offset-0">
                  <SelectValue placeholder="依指派人篩選" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有指派人</SelectItem>
                  <SelectItem value="me">指派給我</SelectItem>
                  <SelectItem value="unassigned">未指派</SelectItem>
                  {assignees.map(user => (
                    <SelectItem key={user.id} value={user.id.toString()}>
                      {user.user_id || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="secondary"
              onClick={() => setIsNewItemOpen(true)}
              className="hover:bg-accent hover:text-accent-foreground"
            >
              <span className="mr-0.5">+</span>新增
            </Button>
          </div>
        </div>

        {/* Items List */}
        {isLoading ? (
          <div className="text-center py-12">載入中...</div>
        ) : items.length === 0 ? (
          <Card className="text-center py-12 bg-white/80">
            <CardContent>
              <div className="text-muted-foreground mb-4">
                <p className="text-lg">找不到任務</p>
                <p className="text-sm mt-1">請嘗試調整篩選條件或新增任務</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary hover:bg-secondary">
                  <TableHead className="w-[80px]">#</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="w-[45%]">標題</TableHead>
                  <TableHead>創建者</TableHead>
                  <TableHead>指派給</TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('created_at')}
                  >
                    建立時間 {sortBy === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort('updated_at')}
                  >
                    更新時間 {sortBy === 'updated_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item, index) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50 group"
                    onClick={() => router.push(`/project/${params.id}/item/${item.id}`)}
                  >
                    <TableCell className="text-muted-foreground font-mono">
                      {items.length - (currentPage - 1) * ITEMS_PER_PAGE - index}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[item.status as keyof typeof statusColors]}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{item.creator_user_id || item.creator_email}</span>
                    </TableCell>
                    <TableCell>
                      {item.assignee_id ? (
                        <span className="text-sm">{item.assignee_user_id || item.assignee_email}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(item.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(item.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditItem(item);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>編輯</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteItem(item.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>刪除</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
                <span className="text-sm text-muted-foreground">
                  顯示 {(currentPage - 1) * ITEMS_PER_PAGE + 1} 到 {Math.min(currentPage * ITEMS_PER_PAGE, items.length)} 筆，共 {items.length} 筆任務
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

        <NewItemDialog
          projectId={Number(params.id)}
          open={isNewItemOpen}
          onOpenChange={setIsNewItemOpen}
          onSuccess={handleCreateSuccess}
        />

        {editingItem && (
          <EditItemDialog
            projectId={Number(params.id)}
            item={editingItem}
            open={isEditItemOpen}
            onOpenChange={setIsEditItemOpen}
            onSuccess={fetchData}
          />
        )}

        <AlertDialog open={!!itemToDelete} onOpenChange={(open: boolean) => !open && setItemToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>您確定要刪除嗎？</AlertDialogTitle>
              <AlertDialogDescription>
                此操作無法復原。這將永久刪除此任務。
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
  );
}
