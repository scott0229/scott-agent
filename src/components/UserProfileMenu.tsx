'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LogOut, User as UserIcon, Upload, Loader2, Edit, Eye, Moon, Sun } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAdminSettings } from "@/contexts/AdminSettingsContext";
import { useTheme } from "@/contexts/ThemeContext";

interface User {
    id: number;
    email: string;
    user_id: string | null;
    avatar_url: string | null;
    role?: string;
    preferences?: string;
}

export function UserProfileMenu() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [editUserId, setEditUserId] = useState('');
    const [editAvatarUrl, setEditAvatarUrl] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const { toast } = useToast();
    const { settings, updateSetting, setAllSettings } = useAdminSettings();
    const { theme, setTheme } = useTheme();

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
                    if (data.user.preferences) {
                        try {
                            const prefs = JSON.parse(data.user.preferences);
                            setAllSettings(prefs);
                        } catch (e) {
                            console.error('Failed to parse preferences', e);
                        }
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
                preferences: JSON.stringify(settings)
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
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer">
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

                            {/* Theme Toggle */}
                            <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                <Label htmlFor="theme-toggle">外觀</Label>
                                <div className="flex items-center gap-2">
                                    {theme === 'dark' ? (
                                        <Moon className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Sun className="h-4 w-4 text-muted-foreground" />
                                    )}
                                    <span className="text-sm">{theme === 'dark' ? '深色模式' : '淺色模式'}</span>
                                    <Switch
                                        id="theme-toggle"
                                        className="ml-auto"
                                        checked={theme === 'dark'}
                                        onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
                                    />
                                </div>
                            </div>


                            {/* Display Settings - Admin Only */}
                            {user.role === 'admin' && (
                                <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                    <Label>顯示設定</Label>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm" className="w-full justify-start gap-2 font-normal">
                                                <Eye className="h-4 w-4" />
                                                欄位顯示 ({[settings.showTradeCode, settings.showPhone, settings.showEmail, settings.showPremium].filter(Boolean).length}/4)
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="w-48">
                                            <DropdownMenuCheckboxItem
                                                checked={settings.showTradeCode}
                                                onCheckedChange={(v) => updateSetting('showTradeCode', v)}
                                            >
                                                交易代碼
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem
                                                checked={settings.showPhone}
                                                onCheckedChange={(v) => updateSetting('showPhone', v)}
                                            >
                                                手機號碼
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem
                                                checked={settings.showEmail}
                                                onCheckedChange={(v) => updateSetting('showEmail', v)}
                                            >
                                                郵件地址
                                            </DropdownMenuCheckboxItem>
                                            <DropdownMenuCheckboxItem
                                                checked={settings.showPremium}
                                                onCheckedChange={(v) => updateSetting('showPremium', v)}
                                            >
                                                權利金
                                            </DropdownMenuCheckboxItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )}

                            {/* Premium Target and Emails - Admin Only */}
                            {user.role === 'admin' && (
                                <>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <Label htmlFor="premium-target">權利金目標</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                id="premium-target"
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                max="100"
                                                value={settings.premiumTargetPercent}
                                                onChange={(e) => updateSetting('premiumTargetPercent', parseFloat(e.target.value) || 0)}
                                                className="w-24"
                                            />
                                            <span className="text-sm text-muted-foreground">%</span>
                                            <div className="ml-2">
                                                <Select
                                                    value={settings.includeStockDiffInPremium === false ? "false" : "true"}
                                                    onValueChange={(val) => updateSetting('includeStockDiffInPremium', val === "true")}
                                                >
                                                    <SelectTrigger className="w-[130px] h-9">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="true" className="cursor-pointer">列入價差</SelectItem>
                                                        <SelectItem value="false" className="cursor-pointer">不列入價差</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id="report-cc-enabled-1" 
                                                checked={settings.reportCcEnabled1 !== false} 
                                                onCheckedChange={(v) => updateSetting('reportCcEnabled1', !!v)} 
                                            />
                                            <Label htmlFor="report-cc-email-1" className="cursor-pointer">同步報表 1</Label>
                                        </div>
                                        <Input
                                            id="report-cc-email-1"
                                            name="report-cc-email-1"
                                            type="text"
                                            value={settings.reportCcEmail1 || ''}
                                            onChange={(e) => updateSetting('reportCcEmail1', e.target.value)}
                                            placeholder="輸入 Email (選填)"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id="report-cc-enabled-2" 
                                                checked={settings.reportCcEnabled2 !== false} 
                                                onCheckedChange={(v) => updateSetting('reportCcEnabled2', !!v)} 
                                            />
                                            <Label htmlFor="report-cc-email-2" className="cursor-pointer">同步報表 2</Label>
                                        </div>
                                        <Input
                                            id="report-cc-email-2"
                                            name="report-cc-email-2"
                                            type="text"
                                            value={settings.reportCcEmail2 || ''}
                                            onChange={(e) => updateSetting('reportCcEmail2', e.target.value)}
                                            placeholder="輸入 Email (選填)"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="report-cc-enabled-3"
                                                checked={settings.reportCcEnabled3 !== false}
                                                onCheckedChange={(v) => updateSetting('reportCcEnabled3', !!v)}
                                            />
                                            <Label htmlFor="report-cc-email-3" className="cursor-pointer">同步報表 3</Label>
                                        </div>
                                        <Input
                                            id="report-cc-email-3"
                                            name="report-cc-email-3"
                                            type="text"
                                            value={settings.reportCcEmail3 || ''}
                                            onChange={(e) => updateSetting('reportCcEmail3', e.target.value)}
                                            placeholder="輸入 Email (選填)"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="report-cc-enabled-4"
                                                checked={settings.reportCcEnabled4 !== false}
                                                onCheckedChange={(v) => updateSetting('reportCcEnabled4', !!v)}
                                            />
                                            <Label htmlFor="report-cc-email-4" className="cursor-pointer">同步報表 4</Label>
                                        </div>
                                        <Input
                                            id="report-cc-email-4"
                                            name="report-cc-email-4"
                                            type="text"
                                            value={settings.reportCcEmail4 || ''}
                                            onChange={(e) => updateSetting('reportCcEmail4', e.target.value)}
                                            placeholder="輸入 Email (選填)"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[100px_1fr] items-start gap-4">
                                        <Label className="pt-1">BCC 寄出報告</Label>
                                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="bcc-include-trade-advice"
                                                    checked={settings.bccIncludeTradeAdvice !== false}
                                                    onCheckedChange={(v) => updateSetting('bccIncludeTradeAdvice', !!v)}
                                                />
                                                <Label htmlFor="bcc-include-trade-advice" className="cursor-pointer font-normal">含交易建議</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="bcc-include-daily-ops"
                                                    checked={settings.bccIncludeDailyOps !== false}
                                                    onCheckedChange={(v) => updateSetting('bccIncludeDailyOps', !!v)}
                                                />
                                                <Label htmlFor="bcc-include-daily-ops" className="cursor-pointer font-normal">含當日操作</Label>
                                            </div>
                                        </div>
                                    </div>
                                </>
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
                                <div className="text-sm text-destructive font-medium bg-destructive-soft p-2 rounded col-span-full">
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
