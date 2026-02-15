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
    type: string;
    operation: string;
    user_id: string;
    code: string;
    final_profit?: number | null;
    quantity: number;
    open_date: number;
    to_date?: number | null;
    strike_price?: number | null;
    settlement_date?: number | null;
}

interface Strategy {
    id: number;
    name: string;
    user_id: string;
    owner_id: number;
    year: number;
    status?: string;
    option_strategy?: string;
    stock_strategy?: string;
    stock_strategy_params?: string;
    stocks: StockTrade[];
    options: Option[];
    created_at: number;
    updated_at: number;
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
        optionStrategies: [] as string[],
        stockStrategies: [] as string[],
        spreadTargetPct: '',
        selectedStocks: [] as number[],
        selectedOptions: [] as number[],
    });
    const [stockFilter, setStockFilter] = useState('all');
    const [optionFilter, setOptionFilter] = useState('all');

    useEffect(() => {
        if (open) {
            setStockFilter('all');
            setOptionFilter('all');
            fetchUsers();
            if (strategy) {
                // Edit mode
                const stockParams = strategy.stock_strategy_params ? JSON.parse(strategy.stock_strategy_params) : {};
                setFormData({
                    name: strategy.name,
                    userId: strategy.user_id,
                    ownerId: strategy.owner_id,
                    status: strategy.status || '進行中',
                    optionStrategies: strategy.option_strategy ? strategy.option_strategy.split(',') : [],
                    stockStrategies: strategy.stock_strategy ? strategy.stock_strategy.split(',') : [],
                    spreadTargetPct: stockParams.spread_target_pct?.toString() || '',
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
                    optionStrategies: [],
                    stockStrategies: [],
                    spreadTargetPct: '',
                    selectedStocks: [],
                    selectedOptions: [],
                });
            }
        }
    }, [open, strategy]);

    const fetchUsers = async () => {
        try {
            const year = currentYear === 'All' ? new Date().getFullYear() : currentYear;
            const res = await fetch(`/api/users?year=${year}`);
            if (res.ok) {
                const data = await res.json();
                // Only show customer-role users
                let filteredUsers = data.users.filter((u: any) => u.role === 'customer');

                // Deduplicate by user_id if multiple users have same ID
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
                    optionStrategy: formData.optionStrategies.length > 0 ? formData.optionStrategies.join(',') : null,
                    stockStrategy: formData.stockStrategies.length > 0 ? formData.stockStrategies.join(',') : null,
                    stockStrategyParams: formData.stockStrategies.includes('價差') && formData.spreadTargetPct
                        ? JSON.stringify({ spread_target_pct: parseFloat(formData.spreadTargetPct) })
                        : null,
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

                <div className="space-y-4 py-4 px-1">
                    {/* Strategy Name */}
                    <div className="flex items-center gap-3">
                        <Label htmlFor="name" className="w-20 shrink-0">策略名稱</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            autoComplete="off"
                        />
                    </div>

                    {/* User Selection */}
                    <div className="flex items-center gap-3">
                        <Label className="w-20 shrink-0">用戶</Label>
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
                        <div className="flex items-center gap-3">
                            <Label className="w-20 shrink-0">狀態</Label>
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

                    {/* Option Strategy Selection */}
                    <div className="flex items-center gap-3">
                        <Label className="w-20 shrink-0">期權策略</Label>
                        <div className="flex items-center gap-4">
                            {['Covered Call', 'Protective Put'].map(opt => (
                                <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                    <Checkbox
                                        checked={formData.optionStrategies.includes(opt)}
                                        onCheckedChange={(checked) => {
                                            setFormData(prev => ({
                                                ...prev,
                                                optionStrategies: checked
                                                    ? [...prev.optionStrategies, opt]
                                                    : prev.optionStrategies.filter(s => s !== opt)
                                            }));
                                        }}
                                    />
                                    {opt}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Stock Strategy Selection */}
                    <div className="flex items-center gap-3">
                        <Label className="w-20 shrink-0">股票策略</Label>
                        <div className="flex items-center gap-4">
                            {['價差', '不持股'].map(opt => (
                                <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                    <Checkbox
                                        checked={formData.stockStrategies.includes(opt)}
                                        onCheckedChange={(checked) => {
                                            setFormData(prev => ({
                                                ...prev,
                                                stockStrategies: checked
                                                    ? [...prev.stockStrategies, opt]
                                                    : prev.stockStrategies.filter(s => s !== opt)
                                            }));
                                        }}
                                    />
                                    {opt}
                                </label>
                            ))}
                            {formData.stockStrategies.includes('價差') && (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-sm text-muted-foreground">目標</span>
                                    <Input
                                        type="number"
                                        value={formData.spreadTargetPct}
                                        onChange={(e) => setFormData(prev => ({ ...prev, spreadTargetPct: e.target.value }))}
                                        className="w-20 h-7 text-sm"
                                        placeholder="5"
                                        step="0.1"
                                    />
                                    <span className="text-sm text-muted-foreground">%</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stock Trades and Options Selection - Side by Side */}
                    {formData.userId && (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Stock Trades Selection */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label>股票交易</Label>
                                    {(() => {
                                        const symbols = [...new Set(stockTrades.map(s => s.symbol))];
                                        if (symbols.length <= 1) return null;
                                        return (
                                            <select
                                                className="text-xs border rounded px-1.5 py-0.5"
                                                value={stockFilter}
                                                onChange={e => setStockFilter(e.target.value)}
                                            >
                                                <option value="all">全部</option>
                                                {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        );
                                    })()}
                                </div>
                                <div className="border rounded-md p-3 h-96 overflow-y-auto space-y-2">
                                    {stockTrades.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">該用戶沒有股票交易記錄</p>
                                    ) : (
                                        stockTrades.filter(s => stockFilter === 'all' || s.symbol === stockFilter).map(stock => {
                                            // Format date as MM/DD
                                            const openDate = new Date(stock.open_date * 1000);
                                            const formattedDate = `${String(openDate.getMonth() + 1).padStart(2, '0')}/${String(openDate.getDate()).padStart(2, '0')}`;

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
                                                        {stock.symbol}_{quantity.toLocaleString()}股_{formattedDate}開倉{stock.status === 'Open' ? (
                                                            (stock as any).source === 'assigned'
                                                                ? <span className="text-green-700"> (Open+指派)</span>
                                                                : <span className="text-green-700"> (Open)</span>
                                                        ) : (
                                                            (stock as any).close_source === 'assigned'
                                                                ? <span className="text-green-700"> (指派)</span>
                                                                : ''
                                                        )}
                                                    </label>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Options Selection */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label>期權交易</Label>
                                    {(() => {
                                        const symbols = [...new Set(options.map(o => o.underlying))];
                                        if (symbols.length <= 1) return null;
                                        return (
                                            <select
                                                className="text-xs border rounded px-1.5 py-0.5"
                                                value={optionFilter}
                                                onChange={e => setOptionFilter(e.target.value)}
                                            >
                                                <option value="all">全部</option>
                                                {symbols.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        );
                                    })()}
                                </div>
                                <div className="border rounded-md p-3 h-96 overflow-y-auto space-y-2">
                                    {options.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">該用戶沒有期權交易記錄</p>
                                    ) : (
                                        options.filter(o => optionFilter === 'all' || o.underlying === optionFilter).map(option => {
                                            // Format expiration date as MM-DD
                                            const toDate = (option as any).to_date ? new Date((option as any).to_date * 1000) : null;
                                            const formattedExpiry = toDate
                                                ? `${String(toDate.getMonth() + 1).padStart(2, '0')}/${String(toDate.getDate()).padStart(2, '0')}`
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
                                                        {option.underlying}_{strikePrice}_{((option as any).type || 'CALL') === 'CALL' ? 'C' : 'P'}_{formattedExpiry}_{quantity.toLocaleString()}口{option.operation === 'Open' ? <span className="text-green-700"> (Open)</span> : ''}
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
