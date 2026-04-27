'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FilterX, ArrowRightLeft, FolderOpen } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransferOptionDialog } from '@/components/TransferOptionDialog';


import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { GroupOverviewDialog } from "@/components/GroupOverviewDialog";
import { BatchSetGroupDialog } from "@/components/BatchSetGroupDialog";

import { useRouter, useSearchParams } from 'next/navigation';
import { useYearFilter } from '@/contexts/YearFilterContext';
import { useAdminSettings } from '@/contexts/AdminSettingsContext';

interface Option {
    id: number | string;
    status: string;
    operation: string | null;
    open_date: number;
    to_date: number | null;
    settlement_date: number | null;
    quantity: number;
    underlying: string;
    type: string;
    strike_price: number;
    collateral: number | null;
    premium: number | null;
    final_profit: number | null;
    profit_percent: number | null;
    delta: number | null;
    iv: number | null;
    capital_efficiency: number | null;
    user_id: string | null;
    code?: string;
    underlying_price: number | null;
    is_assigned?: boolean;
    note?: string | null;
    note_color?: string | null;
    has_separator?: boolean | number;
    group_id?: string | number | null;
    accumulated_shares?: number;
    accumulated_avg_price?: number;
    include_in_options?: number;
}

export default function ClientOptionsPage({ params }: { params: { userId: string } }) {
    const [options, setOptions] = useState<Option[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserValue, setSelectedUserValue] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [transferDialogOpen, setTransferDialogOpen] = useState(false);
    const [tradeToTransfer, setTradeToTransfer] = useState<Option | null>(null);
    const [isGroupOverviewOpen, setIsGroupOverviewOpen] = useState(false);
    const [isBatchGroupOpen, setIsBatchGroupOpen] = useState(false);
    const [groupStatuses, setGroupStatuses] = useState<Record<string, string>>({});

    // Use global year filter instead of local state
    const { selectedYear, setSelectedYear } = useYearFilter();
    const searchParams = useSearchParams();
    // Initialize to 'All' to avoid hydration mismatch, useEffect will sync from URL
    const [selectedUnderlying, setSelectedUnderlying] = useState<string>('All');
    const [selectedType, setSelectedType] = useState<string>('All');
    const [selectedStatus, setSelectedStatus] = useState<string>('All');
    const [selectedOperation, setSelectedOperation] = useState<string>('All');
    const [selectedGroup, setSelectedGroup] = useState<string>('NoFilter');
    const [hideStocks, setHideStocks] = useState<boolean>(false);

    const SEPARATOR_COLORS = [
        '', // 0: None
        'border-orange-200',  // 1: Orange (原始顏色)
        'border-blue-300',    // 2: Blue
        'border-green-500'    // 3: Green
    ];

    const toggleSeparator = async (id: string | number, type: string, currentSeparator: boolean | number | undefined) => {
        let currentState = 0;
        if (typeof currentSeparator === 'number') {
            currentState = currentSeparator;
        } else if (currentSeparator) {
            currentState = 1;
        }

        const nextState = (currentState + 1) % SEPARATOR_COLORS.length;
        
        // Optimistic UI update
        const previousOptions = [...options];
        setOptions(prev => prev.map(opt => opt.id === id ? { ...opt, has_separator: nextState } : opt));

        try {
            const isStock = type === 'STK';
            const realId = isStock ? String(id).split('-')[1] : id;
            const tradeSide = isStock ? 'O' : null;
            const apiPath = isStock ? `/api/stocks/${realId}/separator` : `/api/options/${realId}/separator`;
            
            const res = await fetch(apiPath, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ has_separator: nextState, tradeSide })
            });
            if (!res.ok) throw new Error('Failed to update separator');
        } catch (error) {
            console.error('Separator update error', error);
            // Revert to previous state if API call fails
            setOptions(previousOptions);
        }
    };

    const [ownerId, setOwnerId] = useState<number | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

    const router = useRouter();
    const { settings } = useAdminSettings();

    // Sync filters with URL params
    useEffect(() => {
        const status = searchParams.get('status');
        console.log('[DEBUG] Syncing filters from URL - status:', status);
        setSelectedStatus(status || 'All');

        const underlying = searchParams.get('underlying');
        setSelectedUnderlying(underlying || 'All');

        const type = searchParams.get('type');
        setSelectedType(type || 'All');

        const operation = searchParams.get('operation');
        setSelectedOperation(operation || 'All');

        const group = searchParams.get('group');
        setSelectedGroup(group || 'NoFilter');

        console.log('[DEBUG] After sync - selectedStatus will be:', status || 'All');
    }, [searchParams]);

    useEffect(() => {
        const fetchUserAndCheckRole = async () => {
            try {
                // Fetch current user role
                const authRes = await fetch('/api/auth/me');
                if (authRes.ok) {
                    const authData = await authRes.json();
                    setCurrentUserRole(authData.user?.role || null);
                }

                // Fetch page owner user
                const yearForUser = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                const yearParam = selectedYear === 'All' ? '' : `&year=${selectedYear}`;
                // Fetch all users for selection with year filtering
                const res = await fetch(`/api/users?mode=selection${yearParam}`, {
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.users && data.users.length > 0) {
                    // Filter out admin user
                    let filteredUsers = data.users.filter((u: any) => u.user_id !== 'admin' && u.email !== 'admin@example.com' && u.role !== 'admin');

                    // Deduplicate by user_id/email if multiple users (e.g. across years) have same ID
                    const seen = new Set();
                    filteredUsers = filteredUsers.filter((u: any) => {
                        const key = u.user_id || u.email;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    });

                    filteredUsers.sort((a: any, b: any) => {
                        const nameA = a.user_id || a.email || '';
                        const nameB = b.user_id || b.email || '';
                        return nameA.localeCompare(nameB);
                    });
                    setUsers(filteredUsers);
                    // Find current owner
                    const currentOwner = data.users.find((u: any) => u.id.toString() === params.userId || u.user_id === params.userId);
                    if (currentOwner) {
                        setOwnerId(currentOwner.id);
                        setSelectedUserValue(currentOwner.user_id || currentOwner.email);
                    } else {
                        // Fallback
                        setSelectedUserValue(params.userId);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch user:', error);
            }
        };
        fetchUserAndCheckRole();
    }, [params.userId, selectedYear]);

    const fetchOptions = async () => {
        try {
            const year = selectedYear; // Allow 'All' to be passed directly
            let idParam = '';
            if (params.userId !== 'All') {
                idParam = ownerId ? `ownerId=${ownerId}` : `userId=${params.userId}`;
            }
            const queryParams = [idParam, `year=${year}`].filter(Boolean).join('&');

            const optionsRes = await fetch(`/api/options?${queryParams}`, { cache: 'no-store' });
            const optionsData = await optionsRes.json();
            
            let finalData: Option[] = optionsData.options || [];

            if (!hideStocks) {
                const stocksRes = await fetch(`/api/stocks?${queryParams}`, { cache: 'no-store' });
                const stocksData = await stocksRes.json();
                
                if (stocksData.stocks) {
                    const events: { time: number, type: 'open' | 'close', tradeId: number, quantity: number, price: number, symbol: string }[] = [];
                    
                    stocksData.stocks.forEach((st: any) => {
                        events.push({
                            time: st.open_date,
                            type: 'open',
                            tradeId: st.id,
                            quantity: st.quantity,
                            price: st.open_price,
                            symbol: st.symbol
                        });
                        if (st.status === 'Closed' && st.close_date) {
                            events.push({
                                time: st.close_date,
                                type: 'close',
                                tradeId: st.id,
                                quantity: -st.quantity,
                                price: st.close_price,
                                symbol: st.symbol
                            });
                        }
                    });
                    
                    events.sort((a, b) => {
                        if (a.time !== b.time) return a.time - b.time;
                        if (a.type !== b.type) return a.type === 'open' ? -1 : 1;
                        return a.tradeId - b.tradeId;
                    });
                    
                    const symbolState: Record<string, { totalShares: number, totalCost: number }> = {};
                    const rowOpenState: Record<number, { shares: number, avgPrice: number }> = {};
                    
                    for (const ev of events) {
                        const sym = ev.symbol;
                        if (!symbolState[sym]) symbolState[sym] = { totalShares: 0, totalCost: 0 };
                        
                        let { totalShares, totalCost } = symbolState[sym];
                        
                        if (ev.type === 'open') {
                            if (totalShares === 0) {
                                totalShares = ev.quantity;
                                totalCost = ev.quantity * ev.price;
                            } else if ((totalShares > 0 && ev.quantity > 0) || (totalShares < 0 && ev.quantity < 0)) {
                                totalShares += ev.quantity;
                                totalCost += ev.quantity * ev.price;
                            } else {
                                const newShares = totalShares + ev.quantity;
                                if ((totalShares > 0 && newShares < 0) || (totalShares < 0 && newShares > 0)) {
                                    totalShares = newShares;
                                    totalCost = newShares * ev.price;
                                } else if (newShares === 0) {
                                    totalShares = 0;
                                    totalCost = 0;
                                } else {
                                    totalCost = totalCost * (newShares / totalShares);
                                    totalShares = newShares;
                                }
                            }
                            rowOpenState[ev.tradeId] = {
                                shares: totalShares,
                                avgPrice: totalShares !== 0 ? Math.abs(totalCost / totalShares) : 0
                            };
                        } else {
                            const newShares = totalShares + ev.quantity;
                            if (newShares === 0) {
                                totalShares = 0;
                                totalCost = 0;
                            } else if ((totalShares > 0 && newShares > 0) || (totalShares < 0 && newShares < 0)) {
                                totalCost = totalCost * (newShares / totalShares);
                                totalShares = newShares;
                            } else {
                                totalShares = newShares;
                                totalCost = newShares * ev.price;
                            }
                        }
                        symbolState[sym] = { totalShares, totalCost };
                    }

                    const mappedStocks: Option[] = [];
                    stocksData.stocks.forEach((st: any) => {
                        const state = rowOpenState[st.id] || { shares: 0, avgPrice: 0 };
                        mappedStocks.push({
                            id: `STK-${st.id}`,
                            status: st.status,
                            operation: st.status,
                            open_date: st.open_date,
                            to_date: null,
                            settlement_date: st.close_date || null,
                            quantity: st.quantity,
                            underlying: st.symbol,
                            type: 'STK',
                            strike_price: 0,
                            collateral: null,
                            premium: null,
                            final_profit: st.status === 'Closed' ? (st.close_price - st.open_price) * st.quantity : (st.current_market_price ? (st.current_market_price - st.open_price) * st.quantity : null),
                            profit_percent: st.status === 'Closed' && st.open_price ? (st.close_price - st.open_price) / st.open_price : (st.current_market_price && st.open_price ? (st.current_market_price - st.open_price) / st.open_price : null),
                            delta: null,
                            iv: null,
                            capital_efficiency: null,
                            user_id: st.user_id,
                            code: st.code,
                            underlying_price: st.open_price,
                            is_assigned: st.source === 'assigned' || st.close_source === 'assigned',
                            note: st.note || st.close_note,
                            note_color: st.note_color || st.close_note_color,
                            has_separator: st.has_separator || st.close_has_separator,
                            group_id: st.group_id || st.close_group_id,
                            accumulated_shares: state.shares,
                            accumulated_avg_price: state.avgPrice,
                            include_in_options: st.include_in_options
                        });
                    });
                    finalData = [...finalData, ...mappedStocks];
                }
            }

            setOptions(finalData);
        } catch (error) {
            console.error('Failed to fetch options:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchOptions();
    }, [params.userId, selectedYear, ownerId, hideStocks]);

    const fetchGroupStatuses = async () => {
        if (!ownerId && params.userId !== 'All') return;
        try {
            const queryYear = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const idParam = ownerId ? ownerId : (params.userId !== 'All' ? params.userId : null);
            if (!idParam) return;
            const res = await fetch(`/api/trade-groups?ownerId=${idParam}&year=${queryYear}`);
            const data = await res.json();
            if (data.groups) {
                const statusMap: Record<string, string> = {};
                data.groups.forEach((g: any) => {
                    statusMap[g.name] = g.status;
                });
                setGroupStatuses(statusMap);
            }
        } catch (e) {
            console.error('Failed to fetch group statuses', e);
        }
    };

    useEffect(() => {
        fetchGroupStatuses();
    }, [ownerId, selectedYear, params.userId]);





    // --- Helpers & Filter Logic (Same as before) ---
    const formatDate = (timestamp: number | null) => {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formatTime = (timestamp: number | null) => {
        if (!timestamp) return '-';
        const date = new Date(timestamp * 1000);
        const h = date.getUTCHours();
        const m = date.getUTCMinutes();
        const s = date.getUTCSeconds();
        if (h === 0 && m === 0 && s === 0) return '-';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatOptionTicker = (opt: Option) => {
        const underlying = opt.underlying;
        if (opt.type === 'STK') {
            const assignedText = opt.is_assigned ? '，被行權' : '';
            return opt.underlying_price != null ? `${underlying} (均價 ${opt.underlying_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${assignedText})` : `${underlying}${assignedText}`;
        }
        const typeChar = opt.type === 'PUT' ? 'P' : 'C';
        const strike = opt.strike_price;
        if (!opt.to_date) return `${underlying} - ${strike}${typeChar}`;
        const d = new Date(opt.to_date * 1000);
        const mon = MONTH_ABBR[d.getMonth()];
        const day = d.getDate();
        const yr = d.getFullYear().toString().slice(-2);
        return `${underlying} ${mon}${day}'${yr} ${strike}${typeChar}`;
    };

    const calculateDays = (start: number, end: number | null) => {
        if (!end) return '';
        const diffTime = Math.abs(end * 1000 - start * 1000);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const getDaysHeld = (opt: Option) => {
        if (!opt.settlement_date) return '';
        return calculateDays(opt.open_date, opt.settlement_date);
    }

    const getDaysToExpire = (opt: Option) => {
        if (!opt.to_date) return '';
        return calculateDays(opt.open_date, opt.to_date);
    };

    const handleNoteUpdate = async (id: string | number, type: string, newNote: string) => {
        // Optimistic UI update
        const previousOptions = [...options];
        setOptions(prev => prev.map(opt => opt.id === id ? { ...opt, note: newNote } : opt));

        try {
            const isStock = type === 'STK';
            const realId = isStock ? String(id).split('-')[1] : id;
            const tradeSide = isStock ? String(id).split('-')[2] : null;
            const apiPath = isStock ? `/api/stocks/${realId}/note` : `/api/options/${realId}/note`;
            const res = await fetch(apiPath, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: newNote || null, tradeSide })
            });
            if (!res.ok) throw new Error('Failed to update note');
        } catch (error) {
            console.error('Note update error', error);
            // Revert to previous state if API call fails
            setOptions(previousOptions);
        }
    };

    const handleColorToggle = async (id: string | number, type: string, currentColor: string | null | undefined) => {
        // Toggle logic: dark blue (default/null/blue) -> dark red -> dark green -> dark blue
        const newColor = (!currentColor || currentColor === 'blue') ? 'red' : currentColor === 'red' ? 'green' : 'blue';
        
        setOptions(prev => prev.map(opt => opt.id === id ? { ...opt, note_color: newColor } : opt));

        try {
            const isStock = type === 'STK';
            const realId = isStock ? String(id).split('-')[1] : id;
            const tradeSide = isStock ? String(id).split('-')[2] : null;
            const apiPath = isStock ? `/api/stocks/${realId}/note` : `/api/options/${realId}/note`;
            
            const res = await fetch(apiPath, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_color: newColor, tradeSide })
            });
            if (!res.ok) throw new Error('Failed to update note color');
        } catch (error) {
            console.error('Note color update error', error);
            setOptions(prev => prev.map(opt => opt.id === id ? { ...opt, note_color: currentColor } : opt));
        }
    };

    const handleGroupUpdate = async (id: string | number, type: string, newGroupId: string | null) => {
        const previousOptions = [...options];
        setOptions(prev => prev.map(opt => opt.id === id ? { ...opt, group_id: newGroupId } : opt));

        try {
            const isStock = type === 'STK';
            const realId = isStock ? String(id).split('-')[1] : id;
            const tradeSide = isStock ? String(id).split('-')[2] : null;
            const apiPath = isStock ? `/api/stocks/${realId}/group` : `/api/options/${realId}/group`;
            
            const res = await fetch(apiPath, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: newGroupId, tradeSide })
            });
            if (!res.ok) throw new Error('Failed to update group');
        } catch (error) {
            console.error('Group update error', error);
            setOptions(previousOptions);
        }
    };

    const resetFilters = () => {
        // Note: selectedYear is managed globally via navbar, not reset here
        setSelectedUnderlying('All');
        setSelectedType('All');
        setSelectedStatus('All');
        setSelectedOperation('All');
        setSelectedGroup('NoFilter');
    };

    // Derived State for Filters
    const underlyings = Array.from(new Set(options.map(opt => opt.underlying))).sort();
    const statuses = Array.from(new Set(options.map(opt => opt.status))).sort();
    const operations = Array.from(new Set(options.map(opt => opt.operation || 'Open'))).sort();
    const groups = Array.from(new Set(options.map(opt => opt.group_id).filter(g => g !== null && g !== undefined && String(g).trim() !== ''))).map(String).sort((a, b) => {
        const getPrefixWeight = (str: string) => {
            if (str.startsWith('QQQ')) return 1;
            if (str.startsWith('TQQQ')) return 2;
            if (str.startsWith('GROUP')) return 3;
            return 4;
        };
        const weightA = getPrefixWeight(a);
        const weightB = getPrefixWeight(b);
        if (weightA !== weightB) return weightA - weightB;
        return a.localeCompare(b);
    });

    const filteredOptions = options.filter(opt => {
        // Year filter is handled by API query based on selectedYear
        const underlyingMatch = selectedUnderlying === 'All' || opt.underlying === selectedUnderlying;
        const typeMatch = selectedType === 'All' || opt.type === selectedType || opt.type === 'STK';
        const statusMatch = selectedStatus === 'All' || opt.status === selectedStatus;
        const operationMatch = selectedOperation === 'All' || (opt.operation || 'Open') === selectedOperation || opt.type === 'STK';
        let groupMatch = true;
        if (selectedGroup === 'NoFilter') {
            groupMatch = true;
        } else if (selectedGroup === 'Ungrouped') {
            groupMatch = (opt.group_id === null || opt.group_id === undefined || String(opt.group_id).trim() === '' || String(opt.group_id).trim() === 'none');
        } else if (selectedGroup === 'All') {
            groupMatch = (opt.group_id !== null && opt.group_id !== undefined && String(opt.group_id).trim() !== '' && String(opt.group_id).trim() !== 'none');
        } else {
            groupMatch = String(opt.group_id) === selectedGroup;
        }
        return underlyingMatch && typeMatch && statusMatch && operationMatch && groupMatch;
    });

    // Sort options: strictly by open_date desc
    const sortedOptions = filteredOptions.sort((a, b) => {
        return b.open_date - a.open_date;
    });

    const totalPnL = sortedOptions.reduce((sum, opt) => sum + (opt.final_profit ? opt.final_profit : 0), 0);
    const formattedPnL = totalPnL > 0 ? `+${Math.round(totalPnL).toLocaleString('en-US')}` : (totalPnL < 0 ? Math.round(totalPnL).toLocaleString('en-US') : '');

    return (
        <div className="container mx-auto py-10 max-w-[1600px]">
            <div className="flex items-center gap-4 mb-6">
                {/* Only show back button for non-customer roles */}
                        {currentUserRole && currentUserRole !== 'customer' && (
                    <Button variant="ghost" size="icon" onClick={() => router.push('/options')}>
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                )}
                <h1 className="text-3xl font-bold flex items-center gap-2">
                    期權交易
                    {currentUserRole && currentUserRole !== 'customer' && users.length > 0 ? (
                        <>
                            <Select
                                value={selectedUserValue || params.userId}
                                onValueChange={(newId) => {
                                    // Reset all filters when switching users from the main dropdown
                                    router.push(`/options/${newId}`);
                                }}
                            >
                                <SelectTrigger className="w-auto min-w-[200px] h-auto px-3 py-2 text-3xl font-bold border border-input rounded-md bg-background gap-4 hover:bg-accent hover:text-accent-foreground transition-colors">
                                    <SelectValue placeholder="選擇用戶" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">所有用戶</SelectItem>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.user_id || user.email}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </>
                    ) : (
                        ` - ${params.userId}`
                    )}
                </h1>
                <div className="ml-auto flex items-center gap-4">
                    {/* Filter Controls */}
                    <div className="flex items-center gap-2">

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

                        {/* Year filter removed - using global navbar year selector */}
                        <Select value={selectedUnderlying} onValueChange={setSelectedUnderlying}>
                            <SelectTrigger className="w-[120px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="底層標的" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部標的</SelectItem>
                                {underlyings.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={selectedType} onValueChange={setSelectedType}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="多空" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部類型</SelectItem>
                                <SelectItem value="CALL">CALL</SelectItem>
                                <SelectItem value="PUT">PUT</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={selectedOperation} onValueChange={setSelectedOperation}>
                            <SelectTrigger className="w-[140px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="操作" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部操作</SelectItem>
                                {operations.map(op => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={selectedGroup} onValueChange={(val) => {
                            setSelectedGroup(val);
                            if (val !== 'NoFilter' && val !== 'All' && val !== 'Ungrouped') {
                                setSelectedUnderlying('All');
                                setSelectedType('All');
                                setSelectedStatus('All');
                                setSelectedOperation('All');
                            }
                        }}>
                            <SelectTrigger className="w-[200px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="群組" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="NoFilter">不過濾群組</SelectItem>
                                <SelectItem value="Ungrouped">未設群組</SelectItem>
                                <SelectItem value="All">所有群組</SelectItem>
                                {groups.map(g => (
                                    <SelectItem key={g} value={g}>
                                        {g} {groupStatuses[g] === 'Terminated' ? '(已終止)' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        
                        <Button
                            variant="outline"
                            onClick={() => setIsGroupOverviewOpen(true)}
                            className="ml-2"
                        >
                            群組總覽
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setIsBatchGroupOpen(true)}
                            className="ml-2"
                        >
                            批次設群
                        </Button>
                        <Button 
                            variant={hideStocks ? "default" : "outline"}
                            className="ml-2"
                            onClick={() => setHideStocks(!hideStocks)}
                        >
                            隱藏股票
                        </Button>
                    </div>


                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
                <Table className="whitespace-nowrap">
                    <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                            {/* Table Headers same as original */}
                            <TableHead className="text-center"></TableHead>
                            <TableHead className="text-left"></TableHead>
                            <TableHead className="text-center w-[110px]"></TableHead>
                            {params.userId === 'All' && <TableHead className="text-center">用戶</TableHead>}
                            <TableHead className="text-center">操作</TableHead>
                            <TableHead className="text-center">開倉日</TableHead>
                            <TableHead className="text-center">平倉日</TableHead>
                            <TableHead className="text-center">數量</TableHead>
                            <TableHead className="text-center">標的</TableHead>
                            <TableHead className="text-center">到期天</TableHead>
                            <TableHead className="text-center">持有天</TableHead>
                            <TableHead className="text-center">當時股價</TableHead>

                            {settings.showPremium && <TableHead className="text-center">權利金</TableHead>}
                            <TableHead className="text-center">損益</TableHead>


                            {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
                            <TableHead className="text-center whitespace-nowrap min-w-[75px] px-2">
                                {formattedPnL && <span className={totalPnL > 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>{formattedPnL}</span>}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
                                    載入中...
                                </TableCell>
                            </TableRow>
                        ) : sortedOptions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={19} className="text-center py-8 text-muted-foreground">
                                    尚無資料
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedOptions.map((opt, index) => {
                                return (
                                    <TableRow
                                        key={opt.id}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            toggleSeparator(opt.id, opt.type, opt.has_separator);
                                        }}
                                        className={`text-center transition-colors h-[40px] ${opt.type === 'STK' ? 'bg-blue-50' : 'hover:bg-muted/50'} ${opt.has_separator ? `border-t-4 ${SEPARATOR_COLORS[typeof opt.has_separator === 'number' ? opt.has_separator : 1] || 'border-orange-200'}` : ''}`}
                                    >
                                        <TableCell className="py-1">
                                            <div className="flex items-center justify-center gap-4">
                                                <span>{sortedOptions.length - index}</span>
                                                {opt.note?.trim() ? (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleColorToggle(opt.id, opt.type, opt.note_color);
                                                        }}
                                                        className={`w-4 h-4 rounded-full shrink-0 shadow-sm transition-colors opacity-90 hover:opacity-100 ${
                                                            opt.note_color === 'red' ? 'bg-red-500' : opt.note_color === 'green' ? 'bg-green-600' : 'bg-blue-500'
                                                        }`}
                                                        title="切換註解顏色"
                                                    />
                                                ) : (
                                                    <div className="w-4 h-4 shrink-0" />
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-1 min-w-[180px]">
                                            <input 
                                                className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary focus:outline-none transition-colors px-1 text-left text-[13px] font-medium"
                                                style={{ color: opt.note_color === 'red' ? '#7f1d1d' : opt.note_color === 'green' ? '#15803d' : '#1e3a8a' }}
                                                maxLength={50}
                                                defaultValue={opt.note || ''}
                                                placeholder="..."
                                                onBlur={(e) => {
                                                    if (e.target.value !== (opt.note || '')) {
                                                        handleNoteUpdate(opt.id, opt.type, e.target.value);
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell className="py-1 min-w-[110px]">
                                            <Select 
                                                value={opt.group_id ? String(opt.group_id) : "none"} 
                                                onValueChange={(val) => handleGroupUpdate(opt.id, opt.type, val === "none" ? null : val)}
                                            >
                                                <SelectTrigger hideIcon className={`w-[80px] mx-auto h-7 px-1 py-0 border-none focus:ring-0 shadow-none text-center justify-center font-normal ${
                                                    opt.group_id && String(opt.group_id).endsWith('-0') 
                                                        ? 'bg-yellow-100 hover:bg-yellow-200' 
                                                        : opt.group_id && String(opt.group_id).endsWith('-2')
                                                            ? 'bg-green-100 hover:bg-green-200'
                                                            : 'bg-slate-100 hover:bg-slate-200'
                                                }`}>
                                                    <SelectValue placeholder="-" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none" className="text-muted-foreground">-</SelectItem>
                                                    {[
                                                        'QQQ-0', 'QQQ-1', 'QQQ-2', 'QQQ-3', 'QQQ-4', 'QQQ-5',
                                                        'TQQQ-0', 'TQQQ-1', 'TQQQ-2', 'TQQQ-3', 'TQQQ-4', 'TQQQ-5',
                                                        'GROUP-0', 'GROUP-1', 'GROUP-2', 'GROUP-3', 'GROUP-4', 'GROUP-5'
                                                    ].map(n => (
                                                        <SelectItem key={n} value={n}>{n}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        {params.userId === 'All' && (
                                            <TableCell className="py-1">
                                                <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 border border-slate-200">
                                                    {/* Try to find user display name from users list if possible, else just ID */}
                                                    {(() => {
                                                        const u = users.find(u => u.user_id === opt.user_id || u.id.toString() === opt.user_id);
                                                        return u ? (u.user_id || u.email) : (opt.user_id || '-');
                                                    })()}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell className={`py-1 ${(opt.operation || 'Open') === 'Open' ? 'bg-pink-50' : ''}`}>
                                            <div className="flex items-center justify-center gap-1">
                                                {opt.operation === 'Assigned' ? (
                                                    <span
                                                        className="text-red-600 bg-red-50 px-2 py-1 rounded-sm cursor-pointer hover:bg-red-100 hover:font-semibold transition-all duration-150"
                                                        onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                        title={`點擊過濾 ${opt.operation} 的交易`}
                                                    >
                                                        {opt.operation}
                                                    </span>
                                                ) : (
                                                    <div
                                                        className={`cursor-pointer min-w-[34px] flex justify-center`}
                                                        onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                        title={`點擊過濾 ${opt.operation || 'Open'} 的交易`}
                                                    >
                                                        {opt.operation === 'Expired' ? (
                                                            <Badge className="bg-green-50 text-green-700 hover:bg-green-100 border-none font-normal text-sm px-2 py-0.5">
                                                                Expired
                                                            </Badge>
                                                        ) : opt.operation === 'Transferred' ? (
                                                            <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-none font-normal text-sm px-2 py-0.5">
                                                                Transferred
                                                            </Badge>
                                                        ) : (
                                                            opt.operation || 'Open'
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-1">
                                            {formatDate(opt.open_date)}{(() => {
                                                const time = formatTime(opt.open_date);
                                                return time !== '-' ? ` ${time}` : '';
                                            })()}
                                        </TableCell>
                                        <TableCell className="py-1">
                                            {(opt.operation === 'Open' || !opt.settlement_date) ? "-" : formatDate(opt.settlement_date)}
                                        </TableCell>
                                        <TableCell className={`py-1 ${opt.quantity > 0 ? 'text-green-700' : (opt.type === 'STK' && opt.quantity < 0) ? 'text-red-600' : ''}`}>
                                            {opt.quantity.toLocaleString('en-US')}
                                        </TableCell>
                                        <TableCell className="py-1 font-mono text-sm">
                                            {formatOptionTicker(opt)}
                                        </TableCell>
                                        <TableCell className="py-1">{opt.type === 'STK' ? (opt.accumulated_shares != null ? `股${opt.accumulated_shares.toLocaleString()}` : "-") : getDaysToExpire(opt)}</TableCell>
                                        <TableCell className="py-1">
                                            {opt.type === 'STK' ? (opt.accumulated_avg_price != null && opt.accumulated_shares !== 0 ? `均${opt.accumulated_avg_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "-") : (
                                                (opt.operation === 'Open' || !opt.settlement_date)
                                                    ? (opt.open_date ? Math.floor((Date.now() / 1000 - opt.open_date) / 86400) : '-')
                                                    : getDaysHeld(opt)
                                            )}
                                        </TableCell>
                                        <TableCell className="py-1 font-mono">{opt.underlying_price != null ? opt.underlying_price.toLocaleString() : '-'}</TableCell>

                                        {settings.showPremium && (
                                            <TableCell className="py-1 text-center">
                                                {opt.premium != null ? opt.premium.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '-'}
                                            </TableCell>
                                        )}
                                        <TableCell className={`py-1 ${opt.final_profit !== null && opt.final_profit < 0 ? 'bg-pink-50' : ''}`}>
                                            {opt.final_profit != null ? Math.round(opt.final_profit).toLocaleString('en-US') : '-'}
                                        </TableCell>


                                        {settings.showTradeCode && (
                                            <TableCell className="py-1 text-center font-mono text-sm">
                                                {opt.code || '-'}
                                            </TableCell>
                                        )}
                                        
                                        <TableCell className="py-1">
                                            <div className="flex justify-center">
                                                {(opt.status === 'Open' || opt.operation === 'Transferred') && opt.type !== 'STK' && (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-muted-foreground hover:text-orange-500 hover:bg-orange-50 shrink-0"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setTradeToTransfer(opt);
                                                                        setTransferDialogOpen(true);
                                                                    }}
                                                                >
                                                                    <ArrowRightLeft className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>{opt.operation === 'Transferred' ? '修改轉倉日期' : '手動轉倉 (平倉)'}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                            </div>
                                        </TableCell>

                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
            
            <TransferOptionDialog
                open={transferDialogOpen}
                onOpenChange={setTransferDialogOpen}
                tradeToTransfer={tradeToTransfer}
                onSuccess={() => { fetchOptions(); }}
            />
            
            <BatchSetGroupDialog
                open={isBatchGroupOpen}
                onOpenChange={setIsBatchGroupOpen}
                sortedOptions={sortedOptions as any}
                onSuccess={() => { fetchOptions(); }}
            />

            <GroupOverviewDialog 
                isOpen={isGroupOverviewOpen}
                onOpenChange={setIsGroupOverviewOpen}
                options={options}
                ownerId={ownerId}
                year={selectedYear}
                onStatusChange={fetchGroupStatuses}
                titlePrefix={params.userId !== 'All' ? params.userId : '所有用戶'}
                users={users}
                currentUserRole={currentUserRole}
                selectedUserValue={selectedUserValue || params.userId}
                onUserChange={(newId, targetGroup) => {
                    const paramsObj = new URLSearchParams();
                    const grp = targetGroup !== undefined ? targetGroup : selectedGroup;
                    const isSpecificGroup = grp !== 'NoFilter' && grp !== 'All' && grp !== 'Ungrouped';

                    if (!isSpecificGroup && selectedUnderlying !== 'All') paramsObj.set('underlying', selectedUnderlying);
                    if (!isSpecificGroup && selectedType !== 'All') paramsObj.set('type', selectedType);
                    if (!isSpecificGroup && selectedStatus !== 'All') paramsObj.set('status', selectedStatus);
                    if (!isSpecificGroup && selectedOperation !== 'All') paramsObj.set('operation', selectedOperation);
                    if (grp !== 'NoFilter') paramsObj.set('group', grp);

                    const queryString = paramsObj.toString();
                    const url = queryString ? `/options/${newId}?${queryString}` : `/options/${newId}`;
                    router.push(url);
                    setIsGroupOverviewOpen(false);
                }}
                onSelectGroup={(val) => {
                    setSelectedGroup(val);
                    if (val !== 'NoFilter' && val !== 'All' && val !== 'Ungrouped') {
                        setSelectedUnderlying('All');
                        setSelectedType('All');
                        setSelectedStatus('All');
                        setSelectedOperation('All');
                    }
                }}
            />

        </div>
    );
}
