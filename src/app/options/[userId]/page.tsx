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
import { ArrowLeft, FilterX } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";


import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

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
}

export default function ClientOptionsPage({ params }: { params: { userId: string } }) {
    const [options, setOptions] = useState<Option[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUserValue, setSelectedUserValue] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);


    // Use global year filter instead of local state
    const { selectedYear, setSelectedYear } = useYearFilter();
    const searchParams = useSearchParams();
    // Initialize to 'All' to avoid hydration mismatch, useEffect will sync from URL
    const [selectedMonth, setSelectedMonth] = useState<string>('All');
    const [selectedUnderlying, setSelectedUnderlying] = useState<string>('All');
    const [selectedType, setSelectedType] = useState<string>('All');
    const [selectedStatus, setSelectedStatus] = useState<string>('All');
    const [selectedOperation, setSelectedOperation] = useState<string>('All');
    const [includeStocks, setIncludeStocks] = useState<boolean>(false);

    const [ownerId, setOwnerId] = useState<number | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

    const router = useRouter();
    const { settings } = useAdminSettings();

    // Sync filters with URL params
    useEffect(() => {
        const status = searchParams.get('status');
        console.log('[DEBUG] Syncing filters from URL - status:', status);
        setSelectedStatus(status || 'All');

        const month = searchParams.get('month');
        setSelectedMonth(month || 'All');

        const underlying = searchParams.get('underlying');
        setSelectedUnderlying(underlying || 'All');

        const type = searchParams.get('type');
        setSelectedType(type || 'All');

        const operation = searchParams.get('operation');
        setSelectedOperation(operation || 'All');

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

                    filteredUsers.sort((a: any, b: any) => (b.current_net_equity || 0) - (a.current_net_equity || 0));
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

            if (includeStocks) {
                const stocksRes = await fetch(`/api/stocks?${queryParams}`, { cache: 'no-store' });
                const stocksData = await stocksRes.json();
                
                if (stocksData.stocks) {
                    const mappedStocks: Option[] = stocksData.stocks.map((st: any) => ({
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
                        final_profit: st.close_date ? (st.close_price - st.open_price) * st.quantity : null,
                        profit_percent: st.close_date && st.open_price ? (st.close_price - st.open_price) / st.open_price : null,
                        delta: null,
                        iv: null,
                        capital_efficiency: null,
                        user_id: st.user_id,
                        code: st.code,
                        underlying_price: st.open_price
                    }));
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
    }, [params.userId, selectedYear, ownerId, includeStocks]);





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
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatOptionTicker = (opt: Option) => {
        if (opt.type === 'STK') {
            return `${opt.underlying} STK`;
        }
        const underlying = opt.underlying || '';
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

    const resetFilters = () => {
        // Note: selectedYear is managed globally via navbar, not reset here
        setSelectedMonth('All');
        setSelectedUnderlying('All');
        setSelectedType('All');
        setSelectedStatus('All');
        setSelectedOperation('All');
    };

    // Derived State for Filters
    const years = Array.from(new Set(options.map(opt => new Date(opt.open_date * 1000).getFullYear()))).sort((a, b) => b - a);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const underlyings = Array.from(new Set(options.map(opt => opt.underlying))).sort();
    const statuses = Array.from(new Set(options.map(opt => opt.status))).sort();
    const operations = Array.from(new Set(options.map(opt => opt.operation || 'Open'))).sort();

    const filteredOptions = options.filter(opt => {
        const date = new Date(opt.open_date * 1000);
        // Year filter is handled by API query based on selectedYear
        const monthMatch = selectedMonth === 'All' || (date.getMonth() + 1).toString() === selectedMonth;
        const underlyingMatch = selectedUnderlying === 'All' || opt.underlying === selectedUnderlying;
        const typeMatch = selectedType === 'All' || opt.type === selectedType || opt.type === 'STK';
        const statusMatch = selectedStatus === 'All' || opt.status === selectedStatus;
        const operationMatch = selectedOperation === 'All' || (opt.operation || 'Open') === selectedOperation || opt.type === 'STK';
        return monthMatch && underlyingMatch && typeMatch && statusMatch && operationMatch;
    });

    // Sort options: open positions (Open) first (by open_date desc), then closed positions (by open_date desc)
    const sortedOptions = filteredOptions.sort((a, b) => {
        const aIsOpen = (a.operation || 'Open') === 'Open';
        const bIsOpen = (b.operation || 'Open') === 'Open';

        // If one is open and the other is closed, open comes first
        if (aIsOpen && !bIsOpen) return -1;
        if (!aIsOpen && bIsOpen) return 1;

        // If both have the same status, sort by open_date (newest first)
        return b.open_date - a.open_date;
    });

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
                                    const params = new URLSearchParams();
                                    if (selectedMonth !== 'All') params.set('month', selectedMonth);
                                    if (selectedUnderlying !== 'All') params.set('underlying', selectedUnderlying);
                                    if (selectedType !== 'All') params.set('type', selectedType);
                                    if (selectedStatus !== 'All') params.set('status', selectedStatus);
                                    if (selectedOperation !== 'All') params.set('operation', selectedOperation);

                                    const queryString = params.toString();
                                    const url = queryString ? `/options/${newId}?${queryString}` : `/options/${newId}`;
                                    router.push(url);
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
                        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="月份" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部月份</SelectItem>
                                {months.map(month => <SelectItem key={month} value={month.toString()}>{month}月</SelectItem>)}
                            </SelectContent>
                        </Select>
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
                            <SelectTrigger className="w-[100px] focus:ring-0 focus:ring-offset-0"><SelectValue placeholder="操作" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">全部操作</SelectItem>
                                {operations.map(op => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        
                        <Button 
                            variant={includeStocks ? "default" : "outline"}
                            className="ml-2 gap-2"
                            onClick={() => setIncludeStocks(!includeStocks)}
                        >
                            包含股票
                        </Button>
                    </div>


                </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
                <Table className="whitespace-nowrap">
                    <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                            {/* Table Headers same as original */}
                            <TableHead className="text-center">No.</TableHead>
                            {params.userId === 'All' && <TableHead className="text-center">用戶</TableHead>}
                            <TableHead className="text-center">操作</TableHead>
                            <TableHead className="text-center">開倉日</TableHead>
                            <TableHead className="text-center">口數</TableHead>
                            <TableHead className="text-center">合約</TableHead>
                            <TableHead className="text-center">到期天數</TableHead>
                            <TableHead className="text-center">平倉日</TableHead>
                            <TableHead className="text-center">持有天數</TableHead>
                            <TableHead className="text-center">當時股價</TableHead>

                            <TableHead className="text-center">權利金</TableHead>
                            <TableHead className="text-center">已實現損益</TableHead>


                            {settings.showTradeCode && <TableHead className="text-center">交易代碼</TableHead>}
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
                                const isLastInGroup = index < sortedOptions.length - 1 &&
                                    formatDate(opt.open_date) !== formatDate(sortedOptions[index + 1].open_date);

                                return (
                                    <TableRow
                                        key={opt.id}
                                        className={`hover:bg-muted/50 text-center ${isLastInGroup ? 'border-b-4 border-orange-200' : ''}`}
                                    >
                                        <TableCell>{sortedOptions.length - index}</TableCell>
                                        {params.userId === 'All' && (
                                            <TableCell>
                                                <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                                    {/* Try to find user display name from users list if possible, else just ID */}
                                                    {(() => {
                                                        const u = users.find(u => u.user_id === opt.user_id || u.id.toString() === opt.user_id);
                                                        return u ? (u.user_id || u.email) : (opt.user_id || '-');
                                                    })()}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell className={(opt.operation || 'Open') === 'Open' ? 'bg-pink-50' : ''}>
                                            {opt.operation === 'Assigned' ? (
                                                <span
                                                    className="text-red-600 bg-red-50 px-2 py-1 rounded-sm cursor-pointer hover:bg-red-100 hover:font-semibold transition-all duration-150"
                                                    // onClick={() => setSelectedOperation(opt.operation || 'Open')}
                                                    // onClick={() => setSelectedOperation(opt.operation || 'Open')}
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
                                                    ) : (
                                                        opt.operation || 'Open'
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {formatDate(opt.open_date)}{(() => {
                                                const time = formatTime(opt.open_date);
                                                return time !== '-' ? ` ${time}` : '';
                                            })()}
                                        </TableCell>
                                        <TableCell className={opt.quantity > 0 ? 'text-green-700' : ''}>
                                            {opt.quantity}
                                        </TableCell>
                                        <TableCell className="font-mono text-sm">
                                            {formatOptionTicker(opt)}
                                        </TableCell>
                                        <TableCell>{getDaysToExpire(opt)}</TableCell>
                                        <TableCell>
                                            {(opt.operation === 'Open' || !opt.settlement_date) ? (
                                                "-"
                                            ) : (
                                                formatDate(opt.settlement_date)
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {(opt.operation === 'Open' || !opt.settlement_date)
                                                ? (opt.open_date ? Math.floor((Date.now() / 1000 - opt.open_date) / 86400) : '-')
                                                : getDaysHeld(opt)}
                                        </TableCell>
                                        <TableCell className="font-mono">{opt.underlying_price != null ? opt.underlying_price.toLocaleString() : '-'}</TableCell>

                                        <TableCell>{opt.premium != null ? opt.premium.toLocaleString() : '-'}</TableCell>
                                        <TableCell className={opt.final_profit !== null && opt.final_profit < 0 ? 'bg-pink-50' : ''}>
                                            {opt.final_profit != null ? opt.final_profit.toLocaleString('en-US') : '-'}
                                        </TableCell>


                                        {settings.showTradeCode && (
                                            <TableCell className="text-center font-mono text-sm">
                                                {opt.code || '-'}
                                            </TableCell>
                                        )}

                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

        </div>
    );
}
