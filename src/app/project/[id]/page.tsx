'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { NewItemDialog } from "@/components/NewItemDialog";
import { NewMilestoneDialog } from "@/components/NewMilestoneDialog";

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
  created_at: number;
  updated_at: number;
}

interface Milestone {
  id: number;
  title: string;
  due_date: number | null;
}

const ITEMS_PER_PAGE = 10;

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Dialog states
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [isNewMilestoneOpen, setIsNewMilestoneOpen] = useState(false);

  // Filter states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [milestoneFilter, setMilestoneFilter] = useState('all');
  
  // Sort states
  const [sortBy, setSortBy] = useState<'created_at' | 'updated_at'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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
      queryParams.append('sort', sortBy);
      queryParams.append('order', sortOrder);

      const [projectRes, itemsRes, milestonesRes] = await Promise.all([
        fetch(`/api/projects/${params.id}`),
        fetch(`/api/projects/${params.id}/items?${queryParams.toString()}`, { cache: 'no-store' }),
        fetch(`/api/projects/${params.id}/milestones`)
      ]);
      
      const projectData = await projectRes.json();
      const itemsData = await itemsRes.json();
      const milestonesData = await milestonesRes.json();
      
      if (projectData.success) setProject(projectData.project);
      if (itemsData.success) setItems(itemsData.items);
      if (milestonesData.success) setMilestones(milestonesData.milestones);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [params.id, search, statusFilter, milestoneFilter, sortBy, sortOrder]);

  const toggleSort = (column: 'created_at' | 'updated_at') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
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
    if (!timestamp) return '-';
    // Format: 2026/1/8
    const date = new Date(timestamp * 1000);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  };

  const statusColors = {
    'New': 'bg-blue-100 text-blue-800',
    'In Progress': 'bg-yellow-100 text-yellow-800',
    'Closed': 'bg-green-100 text-green-800',
  };

  if (!project && !isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Project not found</div>;
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => router.push('/project-list')} className="mb-6">
          ← Back to Projects
        </Button>

        {/* Project Header Card */}
        {project && (
          <Card className="mb-8 bg-white/90 backdrop-blur-sm shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 ring-2 ring-primary/20">
                    <AvatarImage src={project.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                      {project.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h1 className="text-3xl font-bold text-foreground">{project.name}</h1>
                    <p className="text-muted-foreground mt-1">{project.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsNewMilestoneOpen(true)}>
                    + New Milestone
                  </Button>
                  <Button onClick={() => setIsNewItemOpen(true)}>
                    + New Item
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Filters Section */}
        <div className="flex flex-wrap gap-4 mb-6">
          <Input 
            placeholder="Search items..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs bg-white/50"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] bg-white/50">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={milestoneFilter} onValueChange={setMilestoneFilter}>
            <SelectTrigger className="w-[180px] bg-white/50">
              <SelectValue placeholder="Filter by milestone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Milestones</SelectItem>
              {milestones.map(m => (
                <SelectItem key={m.id} value={m.id.toString()}>{m.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Items List */}
        {isLoading ? (
          <div className="text-center py-12">Loading...</div>
        ) : items.length === 0 ? (
          <Card className="text-center py-12 bg-white/80">
            <CardContent>
              <div className="text-muted-foreground mb-4">
                <p className="text-lg">No items found</p>
                <p className="text-sm mt-1">Try adjusting your filters or create a new item</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-secondary border-b text-sm font-medium text-muted-foreground">
              <div className="col-span-3">Title</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Milestone</div>
              <div 
                className="col-span-2 cursor-pointer hover:text-foreground flex items-center gap-1"
                onClick={() => toggleSort('created_at')}
              >
                Created {sortBy === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div 
                className="col-span-2 cursor-pointer hover:text-foreground flex items-center gap-1"
                onClick={() => toggleSort('updated_at')}
              >
                Updated {sortBy === 'updated_at' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div className="col-span-1 text-right">Action</div>
            </div>
            <div className="divide-y">
              {paginatedItems.map((item) => (
                <div 
                  key={item.id} 
                  className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-primary/5 cursor-pointer transition-colors items-center group"
                  onClick={() => router.push(`/project/${params.id}/item/${item.id}`)}
                >
                  <div className="col-span-3 truncate">
                    <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <Badge variant="secondary" className={statusColors[item.status as keyof typeof statusColors]}>
                      {item.status}
                    </Badge>
                  </div>
                  <div className="col-span-2 text-sm truncate">
                    {item.milestone_id ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        🎯 {milestones.find(m => m.id === item.milestone_id)?.title}
                      </span>
                    ) : '-'}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {formatDate(item.created_at)}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {formatDate(item.updated_at)}
                  </div>
                  <div className="col-span-1 text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item.id);
                      }}
                    >
                      ×
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

        <NewItemDialog 
          projectId={Number(params.id)} 
          open={isNewItemOpen} 
          onOpenChange={setIsNewItemOpen}
          onSuccess={fetchData}
        />

        <NewMilestoneDialog 
          projectId={Number(params.id)} 
          open={isNewMilestoneOpen} 
          onOpenChange={setIsNewMilestoneOpen}
          onSuccess={fetchData} // Ideally just fetch milestones but full refresh works
        />
      </div>
    </div>
  );
}
