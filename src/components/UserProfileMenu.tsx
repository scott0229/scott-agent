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
import { useToast } from "@/hooks/use-toast";

interface User {
    id: number;
    email: string;
    user_id: string | null;
    avatar_url: string | null;
    role?: string;
    api_key?: string | null;
}

export function UserProfileMenu() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [editUserId, setEditUserId] = useState('');
    const [editAvatarUrl, setEditAvatarUrl] = useState('');
    const [editApiKey, setEditApiKey] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [autoUpdateHour, setAutoUpdateHour] = useState<string>('6');
    const [autoUpdateMinute, setAutoUpdateMinute] = useState<string>('0');
    const [isUpdating, setIsUpdating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const { toast } = useToast();

    const fetchUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.user) {
                    setUser(data.user);
                    console.log('UserProfileMenu - User data:', data.user);
                    console.log('UserProfileMenu - User role:', data.user.role);
                    setEditUserId(data.user.user_id || '');
                    setEditAvatarUrl(data.user.avatar_url || '');
                    setEditApiKey(data.user.api_key || '');
                    // Parse auto update time if exists (format: "HH:MM")
                    if (data.user.auto_update_time) {
                        const [hour, minute] = data.user.auto_update_time.split(':');
                        setAutoUpdateHour(hour || '6');
                        setAutoUpdateMinute(minute || '0');
                    }
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

        // Validate password fields if any are filled
        if (currentPassword || newPassword || confirmPassword) {
            if (!currentPassword) {
                setError('請輸入當前密碼');
                return;
            }
            if (!newPassword) {
                setError('請輸入新密碼');
                return;
            }
            if (newPassword.length < 6) {
                setError('新密碼至少需要 6 個字元');
                return;
            }
            if (newPassword !== confirmPassword) {
                setError('新密碼與確認密碼不一致');
                return;
            }
        }

        setIsUpdating(true);

        try {
            const payload: any = {
                userId: editUserId,
                avatarUrl: editAvatarUrl || null,
                apiKey: editApiKey || null,
                autoUpdateTime: `${autoUpdateHour.padStart(2, '0')}:${autoUpdateMinute.padStart(2, '0')}`
            };

            // Include password fields if changing password
            if (currentPassword && newPassword) {
                payload.currentPassword = currentPassword;
                payload.newPassword = newPassword;
            }

            const res = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json() as { success: boolean; error?: string; user?: User };

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Update failed');
            }

            if (data.user) {
                setUser(data.user);
            }

            // Clear password fields and close dialog
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
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
                        <span>設定</span>
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
                        <DialogTitle>設定</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleUpdateProfile}>
                        <div className="grid gap-4 py-4">
                            {/* Avatar Section */}
                            <div className="flex items-center gap-4">
                                <Label>頭像</Label>
                                <Avatar className="h-16 w-16 border">
                                    <AvatarImage src={editAvatarUrl || undefined} />
                                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                                        {initials}
                                    </AvatarFallback>
                                </Avatar>
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

                            {/* Username Section */}
                            <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                <Label htmlFor="edit-userId">帳號</Label>
                                <Input
                                    id="edit-userId"
                                    value={editUserId}
                                    onChange={(e) => setEditUserId(e.target.value)}
                                    placeholder="設定您的暱稱"
                                    disabled={user.user_id === 'admin'}
                                />
                            </div>
                            {/* API KEY - Only for admin users */}
                            {user.role === 'admin' && (
                                <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                    <Label htmlFor="edit-apiKey">API KEY</Label>
                                    <Input
                                        id="edit-apiKey"
                                        value={editApiKey}
                                        onChange={(e) => setEditApiKey(e.target.value)}
                                        placeholder="輸入您的 Alpha Vantage API KEY"
                                        type="text"
                                    />
                                </div>
                            )}

                            {/* Auto Update Time - Only for admin users */}
                            {user.role === 'admin' && (
                                <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                    <Label htmlFor="auto-update-time">自動更新</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="number"
                                            min="0"
                                            max="23"
                                            value={autoUpdateHour}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 0 && val <= 23) {
                                                    setAutoUpdateHour(e.target.value);
                                                } else if (e.target.value === '') {
                                                    setAutoUpdateHour('');
                                                }
                                            }}
                                            className="flex-1"
                                            placeholder="00"
                                        />
                                        <span className="text-gray-500">:</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            max="59"
                                            value={autoUpdateMinute}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 0 && val <= 59) {
                                                    setAutoUpdateMinute(e.target.value);
                                                } else if (e.target.value === '') {
                                                    setAutoUpdateMinute('');
                                                }
                                            }}
                                            className="flex-1"
                                            placeholder="00"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="col-span-full">
                                <div className="grid gap-3">
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <Label htmlFor="current-password">當前密碼</Label>
                                        <Input
                                            id="current-password"
                                            type="password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            placeholder="輸入當前密碼"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <Label htmlFor="new-password">新密碼</Label>
                                        <Input
                                            id="new-password"
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="至少 6 個字元"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <Label htmlFor="confirm-password">確認新密碼</Label>
                                        <Input
                                            id="confirm-password"
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="再次輸入新密碼"
                                        />
                                    </div>
                                </div>
                            </div>


                            {error && (
                                <div className="text-sm text-red-500 font-medium bg-red-50 p-2 rounded col-span-full">
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
