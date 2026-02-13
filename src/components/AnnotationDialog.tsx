'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Plus, X, Check, ChevronDown } from 'lucide-react';

interface User {
    id: number;
    email: string;
    user_id: string;
}

interface AnnotationItem {
    symbol: string;
}

interface Annotation {
    id: number;
    year: number;
    description: string | null;
    items: { id: number; symbol: string }[];
    owners: { owner_id: number; user_id: string }[];
}

interface AnnotationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    annotation: Annotation | null;
    onSave: () => void;
    currentYear: string;
}

export function AnnotationDialog({ open, onOpenChange, annotation, onSave, currentYear }: AnnotationDialogProps) {
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [userDropdownOpen, setUserDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [formData, setFormData] = useState({
        selectedUsers: [] as { userId: string; ownerId: number }[],
        description: '',
        items: [{ symbol: '' }] as AnnotationItem[],
    });

    useEffect(() => {
        if (open) {
            fetchUsers();
            if (annotation) {
                setFormData({
                    selectedUsers: annotation.owners.map(o => ({ userId: o.user_id, ownerId: o.owner_id })),
                    description: annotation.description || '',
                    items: annotation.items.length > 0
                        ? annotation.items.map(i => ({ symbol: i.symbol }))
                        : [{ symbol: '' }],
                });
            } else {
                setFormData({
                    selectedUsers: [],
                    description: '',
                    items: [{ symbol: '' }],
                });
            }
        }
        setUserDropdownOpen(false);
    }, [open, annotation]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setUserDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const fetchUsers = async () => {
        try {
            const year = currentYear === 'All' ? new Date().getFullYear() : currentYear;
            const res = await fetch(`/api/users?year=${year}`);
            if (res.ok) {
                const data = await res.json();
                let filteredUsers = data.users.filter((u: any) => u.role === 'customer');
                const uniqueUsers: User[] = [];
                const seen = new Set<string>();
                for (const u of filteredUsers) {
                    const key = u.user_id || u.email;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueUsers.push(u);
                    }
                }
                setUsers(uniqueUsers);
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
        }
    };

    const toggleUser = (user: User) => {
        setFormData(prev => {
            const exists = prev.selectedUsers.find(u => u.userId === user.user_id);
            if (exists) {
                return { ...prev, selectedUsers: prev.selectedUsers.filter(u => u.userId !== user.user_id) };
            } else {
                return { ...prev, selectedUsers: [...prev.selectedUsers, { userId: user.user_id, ownerId: user.id }] };
            }
        });
    };

    const handleAddItem = () => {
        setFormData(prev => ({
            ...prev,
            items: [...prev.items, { symbol: '' }],
        }));
    };

    const handleRemoveItem = (index: number) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items.filter((_, i) => i !== index),
        }));
    };

    const handleItemChange = (index: number, value: string) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items.map((item, i) =>
                i === index
                    ? { ...item, symbol: value }
                    : item
            ),
        }));
    };

    const handleSubmit = async () => {
        if (formData.selectedUsers.length === 0) {
            toast({ title: '錯誤', description: '請選擇至少一個用戶', variant: 'destructive' });
            return;
        }

        const validItems = formData.items.filter(i => i.symbol.trim() !== '');
        if (validItems.length === 0 && !formData.description.trim()) {
            toast({ title: '錯誤', description: '請至少填寫一個標的或描述', variant: 'destructive' });
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/annotations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    annotationId: annotation?.id || null,
                    users: formData.selectedUsers,
                    year: parseInt(currentYear) || new Date().getFullYear(),
                    description: formData.description || null,
                    items: validItems,
                }),
            });

            if (res.ok) {
                onSave();
                onOpenChange(false);
            } else {
                const data = await res.json();
                toast({ title: '錯誤', description: data.error || '操作失敗', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: '錯誤', description: '網路錯誤', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const selectedUserIds = new Set(formData.selectedUsers.map(u => u.userId));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[500px] max-w-none sm:max-w-none">
                <DialogHeader>
                    <DialogTitle>{annotation ? '編輯註解' : '新增註解'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4 px-1">
                    {/* Multi-User Selection */}
                    <div className="flex items-start gap-3">
                        <Label className="w-16 shrink-0 mt-2">用戶</Label>
                        <div className="flex-1 relative" ref={dropdownRef}>
                            <button
                                type="button"
                                className="w-full flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-background hover:bg-accent/50 transition-colors"
                                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                            >
                                <span className={formData.selectedUsers.length === 0 ? 'text-muted-foreground' : ''}>
                                    {formData.selectedUsers.length === 0
                                        ? '選擇用戶'
                                        : formData.selectedUsers.map(u => u.userId).join(', ')
                                    }
                                </span>
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </button>
                            {userDropdownOpen && (
                                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
                                    {users.map(user => (
                                        <div
                                            key={user.id}
                                            className="flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-sm"
                                            onClick={() => toggleUser(user)}
                                        >
                                            <div className={`w-4 h-4 border rounded flex items-center justify-center ${selectedUserIds.has(user.user_id) ? 'bg-primary border-primary' : 'border-input'}`}>
                                                {selectedUserIds.has(user.user_id) && <Check className="h-3 w-3 text-primary-foreground" />}
                                            </div>
                                            {user.user_id}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Items (symbol) */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>標的 / 項目</Label>
                            <Button variant="ghost" size="sm" onClick={handleAddItem} className="h-7 px-2 gap-1">
                                <Plus className="h-3 w-3" />
                                新增項目
                            </Button>
                        </div>
                        {formData.items.map((item, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <Input
                                    placeholder="標的名稱 (如 TQQQ, 現金)"
                                    value={item.symbol}
                                    onChange={(e) => handleItemChange(index, e.target.value)}
                                    className="flex-1"
                                    autoComplete="off"
                                />
                                {formData.items.length > 1 && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleRemoveItem(index)}>
                                        <X className="h-3 w-3" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label>描述</Label>
                        <textarea
                            className="w-full border rounded-md p-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="輸入註解描述..."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        取消
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving}>
                        {saving ? '儲存中...' : '儲存'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
