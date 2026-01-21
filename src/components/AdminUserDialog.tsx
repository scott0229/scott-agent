'use client';

import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useYearFilter } from '@/contexts/YearFilterContext';

interface AdminUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    userToEdit?: { id: number; email: string; user_id: string | null; role: string; management_fee?: number; ib_account?: string; phone?: string; initial_cost?: number } | null;
}

// Format number with thousand separators (Borrowed from EditNetEquityDialog)
const formatNumber = (value: string): string => {
    if (!value) return '';
    const isNegative = value.startsWith('-');
    const cleanValue = value.replace(/[^\d.]/g, '');
    if (isNegative && !cleanValue) return '-';
    if (!cleanValue) return '';
    const parts = cleanValue.split('.');
    const integerPart = parts[0];
    const decimalPart = parts.length > 1 ? parts[1] : undefined;
    let formatted = integerPart;
    if (integerPart) {
        formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    const result = decimalPart !== undefined ? `${formatted}.${decimalPart}` : formatted;
    return isNegative ? `-${result}` : result;
};

export function AdminUserDialog({ open, onOpenChange, onSuccess, userToEdit }: AdminUserDialogProps) {
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const { selectedYear } = useYearFilter();
    const isComposing = useRef(false);
    const [formData, setFormData] = useState({
        email: '',
        userId: '',
        password: '',
        role: 'customer',
        managementFee: '4.0',
        ibAccount: '',
        phone: '',
        initialCost: ''
    });

    // Reset or populate form when opening
    useState(() => {
        if (userToEdit) {
            setFormData({
                email: userToEdit.email,
                userId: userToEdit.user_id || '',
                password: '',
                role: userToEdit.role || 'customer',
                managementFee: userToEdit.management_fee?.toString() || '',
                ibAccount: userToEdit.ib_account || '',
                phone: userToEdit.phone || '',
                initialCost: userToEdit.initial_cost ? userToEdit.initial_cost.toLocaleString('en-US') : ''
            });
        }
    });

    // Effect to update form data when userToEdit changes
    const [prevUser, setPrevUser] = useState(userToEdit);
    if (userToEdit !== prevUser) {
        setPrevUser(userToEdit);
        if (userToEdit) {
            setFormData({
                email: userToEdit.email,
                userId: userToEdit.user_id || '',
                password: '',
                role: userToEdit.role || 'customer',
                managementFee: userToEdit.management_fee?.toString() || '',
                ibAccount: userToEdit.ib_account || '',
                phone: userToEdit.phone || '',
                initialCost: userToEdit.initial_cost ? userToEdit.initial_cost.toLocaleString('en-US') : ''
            });
        } else {
            setFormData({ email: '', userId: '', password: '', role: 'customer', managementFee: '4.0', ibAccount: '', phone: '', initialCost: '' });
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const url = '/api/users';
            const method = userToEdit ? 'PUT' : 'POST';
            const year = selectedYear === 'All' ? new Date().getFullYear() : parseInt(selectedYear);
            const cleanInitialCost = formData.initialCost ? formData.initialCost.replace(/,/g, '') : '';
            const body = userToEdit
                ? { ...formData, initialCost: cleanInitialCost, id: userToEdit.id }
                : { ...formData, initialCost: cleanInitialCost, year };

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || (userToEdit ? '更新失敗' : '建立失敗'));
            }



            onSuccess();
            onOpenChange(false);
            if (!userToEdit) {
                setFormData({ email: '', userId: '', password: '', role: 'customer', managementFee: '4.0', ibAccount: '', phone: '', initialCost: '' });
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[380px]">
                <DialogHeader>
                    <DialogTitle>{userToEdit ? '編輯用戶' : '新增使用者'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4" autoComplete="off">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="userId" className="text-right">
                            帳號
                        </Label>
                        <Input
                            id="userId"
                            type="text"
                            value={formData.userId}
                            onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                            className="col-span-2"
                            autoComplete="off"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="password" className="text-right">
                            密碼
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete="off"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            className="col-span-2"
                            // Password only required when creating new user
                            required={!userToEdit}
                            minLength={6}
                            placeholder={userToEdit ? '若不修改請留空' : ''}
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="email" className="text-right">
                            郵件地址
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="col-span-2"
                            autoComplete="off"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">
                            手機號碼
                        </Label>
                        <Input
                            id="phone"
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            className="col-span-2"
                            autoComplete="off"
                            placeholder="0912345678"
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="role" className="text-right">
                            角色
                        </Label>
                        <Select
                            value={formData.role}
                            onValueChange={(val) => setFormData({ ...formData, role: val })}
                        >
                            <SelectTrigger className="col-span-2">
                                <SelectValue placeholder="選擇角色" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="customer">客戶</SelectItem>
                                <SelectItem value="trader">交易員</SelectItem>
                                <SelectItem value="manager">管理者</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {formData.role === 'customer' && (
                        <>
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="managementFee" className="text-right">
                                    管理費率
                                </Label>
                                <div className="col-span-2 relative">
                                    <Input
                                        id="managementFee"
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        placeholder="4.0"
                                        value={formData.managementFee}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (val < 0) return;
                                            setFormData({ ...formData, managementFee: e.target.value });
                                        }}
                                        className="pr-8"
                                        autoComplete="off"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        %
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="ibAccount" className="text-right">
                                    證券帳號
                                </Label>
                                <Input
                                    id="ibAccount"
                                    type="text"
                                    value={formData.ibAccount}
                                    onChange={(e) => setFormData({ ...formData, ibAccount: e.target.value })}
                                    className="col-span-2"
                                    autoComplete="off"
                                    placeholder="U12345678"
                                />
                            </div>
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="initialCost" className="text-right">
                                    年初淨值
                                </Label>
                                <Input
                                    id="initialCost"
                                    type="text"
                                    placeholder="0"
                                    value={formData.initialCost}
                                    onCompositionStart={() => isComposing.current = true}
                                    onCompositionEnd={(e) => {
                                        isComposing.current = false;
                                        setFormData({ ...formData, initialCost: formatNumber(e.currentTarget.value) });
                                    }}
                                    onChange={(e) => {
                                        if (isComposing.current) {
                                            setFormData({ ...formData, initialCost: e.target.value });
                                            return;
                                        }
                                        setFormData({ ...formData, initialCost: formatNumber(e.target.value) });
                                    }}
                                    className="col-span-2"
                                    autoComplete="off"
                                />
                            </div>
                        </>
                    )}

                    <DialogFooter>
                        <Button type="submit" disabled={loading}>
                            {loading ? '處理中...' : (userToEdit ? '儲存變更' : '建立使用者')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
