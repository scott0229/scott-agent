'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

interface User {
    id: number;
    email: string;
    user_id: string;
}

interface StockTrade {
    id: number;
    symbol: string;
    status: string;
    user_id: string;
    code: string;
    open_date: number;
    quantity: number;
}

interface Option {
    id: number;
    underlying: string;
    operation: string;
    user_id: string;
    code: string;
    to_date?: number | null;
    quantity?: number;
    strike_price?: number;
    type?: string;
}

interface Strategy {
    id?: number;
    name: string;
    user_id: string;
    owner_id: number;
    year: number;
    status?: string;
    stocks?: StockTrade[];
    options?: Option[];
}

interface StrategyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    strategy: Strategy | null;
    onSave: () => void;
    currentYear: string;
}

export function StrategyDialog({ open, onOpenChange, strategy, onSave, currentYear }: StrategyDialogProps) {
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [stockTrades, setStockTrades] = useState<StockTrade[]>([]);
    const [options, setOptions] = useState<Option[]>([]);

    const [formData, setFormData] = useState({
        name: '',
        userId: '',
        ownerId: 0,
        status: '進行中',
        selectedStocks: [] as number[],
        selectedOptions: [] as number[],
    });

    useEffect(() => {
        if (open) {
            fetchUsers();
            if (strategy) {
                // Edit mode
                setFormData({
                    name: strategy.name,
                    userId: strategy.user_id,
                    ownerId: strategy.owner_id,
                    status: strategy.status || '進行中',
                    selectedStocks: strategy.stocks?.map(s => s.id) || [],
                    selectedOptions: strategy.options?.map(o => o.id) || [],
                });
                fetchStockTrades(strategy.user_id, strategy.owner_id);
                fetchOptions(strategy.user_id, strategy.owner_id);
            } else {
                // Create mode
                setFormData({
                    name: '',
                    userId: '',
                    ownerId: 0,
                    status: '進行中',
                    selectedStocks: [],
                    selectedOptions: [],
                });
            }
        }
    }, [open, strategy]);

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/users');
            if (res.ok) {
                const data = await res.json();
                // Filter out admin and deduplicate by user_id
                let filteredUsers = data.users.filter((u: User) => u.user_id !== 'admin');

                // Deduplicate by user_id if multiple users (e.g. across years) have same ID
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

    const fetchStockTrades = async (userId: string, ownerId: number) => {
        try {
            const res = await fetch(`/api/stocks?userId=${userId}&year=${currentYear}`);
            if (res.ok) {
                const data = await res.json();
                setStockTrades(data.stocks || []);
            }
        } catch (error) {
            console.error('Failed to fetch stock trades:', error);
        }
    };

    const fetchOptions = async (userId: string, ownerId: number) => {
        try {
            const res = await fetch(`/api/options?userId=${userId}&year=${currentYear}`);
            if (res.ok) {
                const data = await res.json();
                setOptions(data.options || []);
            }
        } catch (error) {
            console.error('Failed to fetch options:', error);
        }
    };

    const handleUserChange = (userId: string) => {
        const user = users.find(u => u.user_id === userId);
        if (user) {
            setFormData({
                ...formData,
                userId: user.user_id,
                ownerId: user.id,
                selectedStocks: [],
                selectedOptions: [],
            });
            fetchStockTrades(user.user_id, user.id);
            fetchOptions(user.user_id, user.id);
        }
    };

    const handleStockToggle = (stockId: number) => {
        setFormData(prev => ({
            ...prev,
            selectedStocks: prev.selectedStocks.includes(stockId)
                ? prev.selectedStocks.filter(id => id !== stockId)
                : [...prev.selectedStocks, stockId]
        }));
    };

    const handleOptionToggle = (optionId: number) => {
        setFormData(prev => ({
            ...prev,
            selectedOptions: prev.selectedOptions.includes(optionId)
                ? prev.selectedOptions.filter(id => id !== optionId)
                : [...prev.selectedOptions, optionId]
        }));
    };

    const handleSubmit = async () => {
        if (!formData.name) {
            toast({
                title: '錯誤',
                description: '請輸入策略名稱',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.userId) {
            toast({
                title: '錯誤',
                description: '請選擇用戶',
                variant: 'destructive',
            });
            return;
        }

        setSaving(true);
        try {
            const url = strategy ? `/api/strategies/${strategy.id}` : '/api/strategies';
            const method = strategy ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    userId: formData.userId,
                    ownerId: formData.ownerId,
                    year: parseInt(currentYear),
                    status: formData.status,
                    stockTradeIds: formData.selectedStocks,
                    optionIds: formData.selectedOptions,
                }),
            });

            if (res.ok) {
                onSave();
                onOpenChange(false);
            } else {
                const data = await res.json();
                toast({
                    title: '錯誤',
                    description: data.error || '操作失敗',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: '錯誤',
                description: '網路錯誤',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[35vw] max-w-none sm:max-w-none max-h-[95vh]">
                <DialogHeader>
                    <DialogTitle>{strategy ? '編輯策略' : '新增策略'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4 px-1 overflow-y-auto max-h-[calc(90vh-180px)]">
                    {/* Strategy Name */}
                    <div className="space-y-2">
                        <Label htmlFor="name">策略名稱</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            autoComplete="off"
                        />
                    </div>

                    {/* User Selection */}
                    <div className="space-y-2">
                        <Label className="inline-block">用戶</Label>
                        <Select
                            value={formData.userId}
                            onValueChange={handleUserChange}
                            disabled={!!strategy}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {users.map(user => (
                                    <SelectItem key={user.id} value={user.user_id}>
                                        {user.user_id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Status Selection - Only show in edit mode */}
                    {strategy && (
                        <div className="space-y-2">
                            <Label>狀態</Label>
                            <Select
                                value={formData.status}
                                onValueChange={(value) => setFormData({ ...formData, status: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="進行中">進行中</SelectItem>
                                    <SelectItem value="已結案">已結案</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Stock Trades and Options Selection - Side by Side */}
                    {formData.userId && (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Stock Trades Selection */}
                            <div className="space-y-2">
                                <Label>股票交易</Label>
                                <div className="border rounded-md p-3 h-64 overflow-y-auto space-y-2">
                                    {stockTrades.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">該用戶沒有股票交易記錄</p>
                                    ) : (
                                        stockTrades.map(stock => {
                                            // Format date as YY-MM-DD
                                            const openDate = new Date(stock.open_date * 1000);
                                            const formattedDate = `${String(openDate.getFullYear()).slice(-2)}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;

                                            // Get quantity from stock trade (assuming it has a quantity field)
                                            const quantity = (stock as any).quantity || 0;

                                            return (
                                                <div key={stock.id} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`stock-${stock.id}`}
                                                        checked={formData.selectedStocks.includes(stock.id)}
                                                        onCheckedChange={() => handleStockToggle(stock.id)}
                                                    />
                                                    <label
                                                        htmlFor={`stock-${stock.id}`}
                                                        className="text-xs cursor-pointer flex-1 whitespace-nowrap"
                                                    >
                                                        {stock.symbol}_{quantity}股_{formattedDate}開倉
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Options Selection */}
                            <div className="space-y-2">
                                <Label>期權交易</Label>
                                <div className="border rounded-md p-3 h-64 overflow-y-auto space-y-2">
                                    {options.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">該用戶沒有期權交易記錄</p>
                                    ) : (
                                        options.map(option => {
                                            // Format expiration date as MM-DD
                                            const toDate = (option as any).to_date ? new Date((option as any).to_date * 1000) : null;
                                            const formattedExpiry = toDate
                                                ? `${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`
                                                : '';

                                            const quantity = Math.abs((option as any).quantity || 0);
                                            const strikePrice = (option as any).strike_price || 0;

                                            return (
                                                <div key={option.id} className="flex items-center space-x-2">
                                                    <Checkbox
                                                        id={`option-${option.id}`}
                                                        checked={formData.selectedOptions.includes(option.id)}
                                                        onCheckedChange={() => handleOptionToggle(option.id)}
                                                    />
                                                    <label
                                                        htmlFor={`option-${option.id}`}
                                                        className="text-xs cursor-pointer flex-1 whitespace-nowrap"
                                                    >
                                                        {option.underlying}_{(option as any).type || 'CALL'}_{quantity}口_{formattedExpiry}到期_行權價{strikePrice}
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
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
