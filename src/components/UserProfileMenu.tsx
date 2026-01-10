'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { LogOut, User as UserIcon, Upload, Loader2, Edit } from 'lucide-react';

interface User {
    id: number;
    email: string;
    user_id: string | null;
    avatar_url: string | null;
    role?: string;
}

export function UserProfileMenu() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [editUserId, setEditUserId] = useState('');
    const [editAvatarUrl, setEditAvatarUrl] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();

    const fetchUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    setUser(data.user);
                    setEditUserId(data.user.user_id || '');
                    setEditAvatarUrl(data.user.avatar_url || '');
                }
            }
        } catch (error) {
            console.error('Failed to fetch user:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUser();
    }, []);

    const handleLogout = async () => {
        setIsLoggingOut(true);
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            router.push('/login');
            router.refresh();
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            setIsLoggingOut(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError('');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json() as { success: boolean; url?: string; error?: string };

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Upload failed');
            }

            setEditAvatarUrl(data.url || '');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsUpdating(true);

        try {
            const res = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: editUserId, avatarUrl: editAvatarUrl || null }),
            });

            const data = await res.json() as { success: boolean; error?: string; user?: User };

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Update failed');
            }

            if (data.user) {
                setUser(data.user);
            }
            setIsEditOpen(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    if (loading) return <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />;
    if (!user) return null;

    const displayName = user.user_id || user.email.split('@')[0];
    const initials = displayName.charAt(0).toUpperCase();

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger className="relative h-10 w-10 rounded-full overflow-hidden hover:opacity-80 transition-opacity focus:outline-none cursor-pointer">
                    <Avatar className="h-10 w-10 border border-border">
                        <AvatarImage src={user.avatar_url || undefined} alt={displayName} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                            {initials}
                        </AvatarFallback>
                    </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuItem onClick={() => setIsEditOpen(true)} className="cursor-pointer">
                        <Edit className="mr-2 h-4 w-4" />
                        <span>編輯個人資料</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600 cursor-pointer">
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>登出</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>編輯個人資料</DialogTitle>
                        <DialogDescription>
                            更新您的頭像與顯示名稱。
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleUpdateProfile}>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label>頭像</Label>
                                <div className="flex items-center gap-4">
                                    <Avatar className="h-16 w-16 border">
                                        <AvatarImage src={editAvatarUrl || undefined} />
                                        <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col gap-2">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleAvatarUpload}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isUploading}
                                        >
                                            {isUploading ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    上傳中...
                                                </>
                                            ) : (
                                                <>
                                                    <Upload className="mr-2 h-4 w-4" />
                                                    上傳圖片
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="edit-userId">使用者 ID (暱稱)</Label>
                                <Input
                                    id="edit-userId"
                                    value={editUserId}
                                    onChange={(e) => setEditUserId(e.target.value)}
                                    placeholder="設定您的暱稱"
                                />
                            </div>
                            {error && (
                                <div className="text-sm text-red-500 font-medium bg-red-50 p-2 rounded">
                                    {error}
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>
                                取消
                            </Button>
                            <Button type="submit" disabled={isUpdating || isUploading}>
                                {isUpdating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        儲存中...
                                    </>
                                ) : (
                                    '儲存變更'
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
