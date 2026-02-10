'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { AdminUserDialog } from '@/components/AdminUserDialog';
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Download, Upload, Wallet, DollarSign, FileText, Copy, FileUp, FolderOpen, HardDrive } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { UserSelectionDialog } from "@/components/UserSelectionDialog";
import { ProgressDialog } from "@/components/ProgressDialog";


interface User {
    id: number;
    email: string;
    user_id: string | null;
    role: string;
    management_fee?: number;
    ib_account?: string;
    phone?: string;
    initial_cost?: number;
    options_count?: number;
    open_count?: number;
    net_deposit?: number;
    created_at: number;
    deposits_count?: number;
    interest_count?: number;
    fees_count?: number;
    total_profit?: number;
    current_net_equity?: number;
    stock_trades_count?: number;
    strategies_count?: number;
}

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export default function AdminUsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [userToDelete, setUserToDelete] = useState<number | null>(null);
    const [importing, setImporting] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null);
    const [marketDataCount, setMarketDataCount] = useState(0);

    // New State for Selection/Progress
    const [exportSelectionOpen, setExportSelectionOpen] = useState(false);
    const [importSelectionOpen, setImportSelectionOpen] = useState(false);
    const [progressOpen, setProgressOpen] = useState(false);
    const [progressValue, setProgressValue] = useState(0);
    const [progressMessage, setProgressMessage] = useState("");

    // In-Dialog Progress State (Import)
    const [importProcessing, setImportProcessing] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [completedImportIds, setCompletedImportIds] = useState<(number | string)[]>([]);

    // In-Dialog Progress State (Export)
    const [exportProcessing, setExportProcessing] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Report Generation State
    const [reportDialog, setReportDialog] = useState<{ open: boolean; userId: number; report: string } | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

    // Data holders
    const [selectionUsers, setSelectionUsers] = useState<any[]>([]); // For dialog options
    const [pendingImportData, setPendingImportData] = useState<any>(null); // To hold parsed JSON before import

    // IB Statement Import State
    const [ibImportDialogOpen, setIbImportDialogOpen] = useState(false);
    const [ibImportPreview, setIbImportPreview] = useState<any>(null);
    const [ibImportFile, setIbImportFile] = useState<File | null>(null);
    const [ibImporting, setIbImporting] = useState(false);
    const [ibStockPreview, setIbStockPreview] = useState<any>(null);

    // Batch IB Import State
    const [batchDialogOpen, setBatchDialogOpen] = useState(false);
    const [batchImporting, setBatchImporting] = useState(false);
    const [batchProgress, setBatchProgress] = useState(0);
    const [batchMessage, setBatchMessage] = useState('');
    const [batchFiles, setBatchFiles] = useState<Array<{ file: File; date: Date; dateStr: string; fileName: string; userAlias: string }>>([]);
    const [batchResults, setBatchResults] = useState<Array<{ file: string; date: string; user: string; status: string }>>([]);
    const [batchError, setBatchError] = useState<string | null>(null);
    const [batchDateWarnings, setBatchDateWarnings] = useState<string[]>([]);
    const singleFileInputRef = useRef<HTMLInputElement>(null);
    const dirInputRef = useRef<HTMLInputElement>(null);
    const jsonImportRef = useRef<HTMLInputElement>(null);

    const { toast } = useToast();
    const router = useRouter();
    const { selectedYear } = useYearFilter();

    const fetchCurrentUser = async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                setCurrentUser(data.user);
            }
        } catch (error) {
            console.error('Failed to fetch current user', error);
        }
    };

    const handleEdit = (user: User) => {
        setEditingUser(user);
        setDialogOpen(true);
    };

    const fetchUsers = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            // Fetch users filtered by year
            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
            const res = await fetch(`/api/users?year=${year}`);
            if (res.status === 403) {
                toast({
                    variant: "destructive",
                    title: "權限不足",
                    description: "您沒有權限訪問此頁面",
                });
                router.push('/');
                return;
            }
            const data = await res.json();
            if (data.users) {
                setUsers(data.users);
            }
            if (data.meta && typeof data.meta.marketDataCount === 'number') {
                setMarketDataCount(data.meta.marketDataCount);
            }
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        setMounted(true);
        fetchCurrentUser();
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [selectedYear]); // Add selectedYear dependency

    const handleDelete = async (id: number) => {
        setUserToDelete(id);
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;

        try {
            // Delete user
            const res = await fetch(`/api/users/${userToDelete}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to delete');
            }


            fetchUsers(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        } finally {
            setUserToDelete(null);
        }
    };

    const formatUserReport = (data: any) => {
        const formatMoney = (val: number) => new Intl.NumberFormat('en-US').format(Math.round(val));
        const formatPercent = (val: number) => `${(val * 100).toFixed(2)}%`;

        let report = `${data.user_id}\n`;
        report += `帳戶淨值 : ${formatMoney(data.accountNetWorth)}\n`;
        report += `2026成本 : ${formatMoney(data.cost2026)}\n`;
        report += `2026淨利 : ${formatMoney(data.netProfit2026)}\n`;
        report += `帳上現金 : ${formatMoney(data.cashBalance)}\n`;
        report += `潛在融資 : ${formatPercent(data.marginRate)}\n`;
        report += `----------------------------------------\n`;
        report += `年初至今 : ${formatPercent(data.ytdReturn)}\n`;
        report += `最大跌幅 : ${formatPercent(data.maxDrawdown)}\n`;
        report += `年標準差 : ${formatPercent(data.annualStdDev)}\n`;
        report += `夏普比率 : ${data.sharpeRatio.toFixed(2)}\n`;
        report += `----------------------------------------\n`;

        // Stock positions
        if (data.stockPositions && data.stockPositions.length > 0) {
            data.stockPositions.forEach((pos: any) => {
                report += `${pos.symbol} ${formatMoney(pos.quantity)} 股\n`;
            });
            report += `----------------------------------------\n`;
        }

        // Quarterly premium
        report += `季-累積權利金 : $${formatMoney(data.quarterlyPremium)}\n`;
        report += `季-目標權利金 : $${formatMoney(data.quarterlyTarget)}\n`;
        report += `----------------------------------------\n`;

        // Annual premium
        report += `年-累積權利金 : $${formatMoney(data.annualPremium)}\n`;
        report += `年-目標權利金 : $${formatMoney(data.annualTarget)}\n`;
        report += `----------------------------------------\n`;

        // Open options
        if (data.openOptions && data.openOptions.length > 0) {
            data.openOptions.forEach((opt: any) => {
                // to_date is Unix timestamp, convert to date string
                const expiryDate = opt.to_date ? new Date(opt.to_date * 1000) : null;
                const expiry = expiryDate ? `${String(expiryDate.getMonth() + 1).padStart(2, '0')}/${String(expiryDate.getDate()).padStart(2, '0')}` : '';
                const quantity = Math.abs(opt.quantity);
                const optType = opt.type.toLowerCase();
                // Premium is negative for sold options in the database
                report += `${quantity}口 ${expiry} sell-${opt.underlying}-${optType} ${opt.strike_price}, 權利金 ${formatMoney(Math.abs(opt.premium))}\n`;
            });
        }

        return report;
    };

    const handleGenerateReport = async (userId: number) => {
        setIsGeneratingReport(true);
        try {
            const res = await fetch(`/api/users/${userId}/report`);
            const data = await res.json();

            if (data.success) {
                const report = formatUserReport(data.reportData);
                setReportDialog({ open: true, userId, report });
            } else {
                toast({
                    variant: "destructive",
                    title: "錯誤",
                    description: data.error || '無法生成報告',
                });
            }
        } catch (error) {
            console.error('Failed to generate report:', error);
            toast({
                variant: "destructive",
                title: "錯誤",
                description: '無法生成報告',
            });
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const handleExportClick = () => {
        // Prepare selection list from current users (excluding admin)
        const exportableUsers: { id: number | string; display: string; checked: boolean }[] = users
            .filter(u => u.email !== 'admin')
            .map(u => ({
                id: u.id,
                display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'})`,
                checked: true
            }));

        // Calculate Totals for Labels
        const totalOptions = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.options_count || 0), 0);



        const totalStocks = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.stock_trades_count || 0), 0);

        const totalStrategies = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.strategies_count || 0), 0);

        // Add Options Records Option
        exportableUsers.push({
            id: 'options_records',
            display: `期權交易記錄 (${totalOptions} 筆)`,
            checked: true
        });

        // Add Stock Trades Option
        exportableUsers.push({
            id: 'stock_trades',
            display: `股票交易記錄 (${totalStocks} 筆)`,
            checked: true
        });

        // Add Strategies Option
        exportableUsers.push({
            id: 'strategies',
            display: `投資策略資料 (${totalStrategies} 個)`,
            checked: true
        });



        // Add Market Data Option
        exportableUsers.push({
            id: 'market_data',
            display: `歷史股價資料 (${marketDataCount} 筆)`,
            checked: true
        });

        setSelectionUsers(exportableUsers);
        setExportProcessing(false);
        setExportProgress(0);
        setExportSelectionOpen(true);
    };

    const confirmExport = async (selectedIds: (number | string)[]) => {
        // DO NOT close dialog, show progress in-dialog
        try {
            setExportProcessing(true);
            setExportProgress(10); // Start

            const year = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;

            // Separate Options selection
            const includeMarketData = selectedIds.includes('market_data');
            // deposit_records removed
            const includeOptionsRecords = selectedIds.includes('options_records');
            const includeStockRecords = selectedIds.includes('stock_trades');
            const includeStrategies = selectedIds.includes('strategies');

            const realUserIds = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'strategies'
            );

            // Call POST endpoint with selected IDs
            const res = await fetch('/api/users/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYear,
                    userIds: realUserIds,
                    includeMarketData: includeMarketData,
                    includeOptionsRecords: includeOptionsRecords,
                    includeStockRecords: includeStockRecords,
                    includeStrategies: includeStrategies
                })
            });

            setExportProgress(70);

            if (!res.ok) {
                throw new Error('匯出失敗');
            }

            const data = await res.json();
            setExportProgress(100);

            // Create JSON blob and download
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `users_export_${dateStr}_(${data.count}).json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error: any) {
            setExportProcessing(false);
            toast({
                variant: "destructive",
                title: "匯出失敗",
                description: error.message,
            });
        }
    };

    const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            let usersList = [];
            if (Array.isArray(data)) {
                usersList = data;
                setPendingImportData({ users: data });
            } else {
                usersList = data.users || [];
                setPendingImportData(data);
            }

            if (!usersList || usersList.length === 0) {
                throw new Error("檔案中沒有使用者資料");
            }

            const importableUsers: { id: number | string; display: string; checked: boolean; disabled?: boolean }[] = usersList.map((u: any, idx: number) => {
                const exists = users.some(existing => existing.email === u.email);
                return {
                    id: u.email, // Use email as unique key for selection
                    display: `${u.user_id || u.email.split('@')[0]} (${u.ib_account || 'No IB'})`,
                    checked: !exists,
                    disabled: exists,
                    statusLabel: exists ? '已存在' : undefined
                };
            });

            // Check for Deposit Records choice REMOVED (Merged into net_equity)
            const totalOptions = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.options) ? u.options.length : 0), 0);
            const totalStocks = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.stock_trades) ? u.stock_trades.length : 0), 0);

            // Check for Options Records choice
            importableUsers.push({
                id: 'options_records',
                display: `期權交易記錄 (${totalOptions} 筆)`,
                checked: totalOptions > 0,
                disabled: totalOptions === 0
            } as any);



            // Check for Stock Trades choice
            importableUsers.push({
                id: 'stock_trades',
                display: `股票交易記錄 (${totalStocks} 筆)`,
                checked: totalStocks > 0,
                disabled: totalStocks === 0
            } as any);

            // Check for Strategies
            const totalStrategies = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.strategies) ? u.strategies.length : 0), 0);
            importableUsers.push({
                id: 'strategies',
                display: `投資策略資料 (${totalStrategies} 個)`,
                checked: totalStrategies > 0,
                disabled: totalStrategies === 0
            } as any);


            // Check for Market Data
            if (data.market_prices && data.market_prices.length > 0) {
                importableUsers.push({
                    id: 'market_data',
                    display: `歷史股價資料 (${data.market_prices.length} 筆)`,
                    checked: true
                });
            }

            setSelectionUsers(importableUsers);
            setImportProcessing(false);
            setImportProgress(0);
            setCompletedImportIds([]);
            setImportSelectionOpen(true);

            // Reset input
            event.target.value = '';
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "讀取檔案失敗",
                description: error.message,
            });
        }
    };

    const confirmImport = async (selectedIds: (number | string)[]) => {
        // DO NOT close dialog, start processing
        if (!pendingImportData) return;

        try {
            setImportProcessing(true);
            setImportProgress(0);
            setCompletedImportIds([]);

            const importMarketData = selectedIds.includes('market_data');
            // deposit_records removed
            const importOptions = selectedIds.includes('options_records');
            const importStocks = selectedIds.includes('stock_trades');
            const importStrategies = selectedIds.includes('strategies');

            const selectedUserEmails = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'strategies'
            );

            const allUsers = pendingImportData.users || [];
            // Filter users based on selection
            const selectedUsers = allUsers.filter((u: any) => selectedUserEmails.includes(u.email));

            // Prepare Payload Structure
            const marketPrices = pendingImportData.market_prices || [];
            const sourceYear = pendingImportData.sourceYear;
            const targetYear = selectedYear === 'All' ? 'All' : selectedYear;

            // Scenario 1: Only Market Data selected
            if (importMarketData && selectedUsers.length === 0) {
                setImportProgress(10);
                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        users: [], // No users
                        market_prices: marketPrices,
                        sourceYear: sourceYear
                    }),
                });

                if (!res.ok) {
                    const result = await res.json();
                    throw new Error(result.error || 'Market data import failed');
                }

                setImportProgress(100);
                setCompletedImportIds(['market_data']);
                fetchUsers(true);
                return;
            }

            // Scenario 2: Users (and optionally Market Data / Options / Interest)
            // Step 2: Batch Upload Users
            const TOTAL = selectedUsers.length;
            const BATCH_SIZE = 5; // Import 5 users at a time
            let processed = 0;
            // Unused variables commented out to prevent linter warnings
            // let totalImported = 0;
            // let totalSkipped = 0;
            const errors: string[] = [];

            for (let i = 0; i < TOTAL; i += BATCH_SIZE) {
                const chunk = selectedUsers.slice(i, i + BATCH_SIZE);

                const processedChunk = chunk.map((u: any) => {
                    const clone = { ...u };
                    // deposit logic removed
                    if (!importOptions) delete clone.options;
                    if (!importStocks) delete clone.stock_trades;
                    if (!importStrategies) delete clone.strategies;
                    return clone;
                });

                // Only include market_prices in the VERY FIRST Request if selected
                const chunkPayload = {
                    users: processedChunk,
                    market_prices: (i === 0 && importMarketData) ? marketPrices : [],
                    sourceYear: sourceYear
                };

                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(chunkPayload),
                });

                const result = await res.json();

                if (!res.ok) {
                    throw new Error(result.error || `Batch ${i} failed`);
                }

                // totalImported += (result.imported || 0) + (result.updated || 0);
                // totalSkipped += (result.skipped || 0);
                if (result.errors) errors.push(...result.errors);

                // Update Progress
                setCompletedImportIds(prev => {
                    const newIds = [...prev, ...chunk.map((u: any) => u.email)];
                    // Mark global items as completed after first batch if included
                    if (i === 0 && importMarketData && !prev.includes('market_data')) {
                        newIds.push('market_data');
                    }
                    if (i === 0 && importOptions && !prev.includes('options_records')) {
                        newIds.push('options_records');
                    }
                    if (i === 0 && importStocks && !prev.includes('stock_trades')) {
                        newIds.push('stock_trades');
                    }
                    return newIds;
                });

                processed += chunk.length;
                const progressPct = Math.round((processed / TOTAL) * 90); // Scale to 90%
                setImportProgress(progressPct);
            }

            // FORCE 100% to ensure UI unlocks
            setImportProgress(100);
            // Refresh list but keep dialog state stable until closed
            fetchUsers(true);

            if (errors.length > 0) {
                toast({
                    variant: "destructive",
                    title: "匯入完成但有錯誤",
                    description: `共有 ${errors.length} 個錯誤發生。`,
                });
            }

        } catch (error: any) {
            setImportProcessing(false);
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        }
    };
    // ...
    // Note: I will update the UserSelectionDialog instances below in the JSX return part in another pass or rely on multi chunk?
    // Wait, the instruction only covered the logic functions. I need to update the JSX return to include the new dependencies too.
    // The previous tool call covered lines 171-424.
    // I need to update the JSX part too. 
    // Let's rely on `multi_replace` or just do it all here if I can find the JSX.
    // The JSX is further down.
    // I will use `TargetContent` for the function bodies.
    // I will handle the JSX update in a separate call or try to verify if I can reach it.
    // The file is 791 lines.
    // `confirmImport` ends around line 430.
    // `dependencies` prop is passed in JSX around line 700.
    // I will stick to updating functions first.


    // Batch IB Import: Chinese month map for date extraction
    const BATCH_MONTH_MAP: Record<string, number> = {
        '一月': 1, '二月': 2, '三月': 3, '四月': 4,
        '五月': 5, '六月': 6, '七月': 7, '八月': 8,
        '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
    };

    const extractDateFromHtml = (html: string): { date: Date; dateStr: string; userAlias: string } | null => {
        const titleMatch = html.match(/<title>.*?活動賬單\s+([\u4e00-\u9fff]+)\s+(\d+),\s+(\d{4})/);
        if (!titleMatch) return null;
        const month = BATCH_MONTH_MAP[titleMatch[1]];
        if (!month) return null;
        const day = parseInt(titleMatch[2]);
        const year = parseInt(titleMatch[3]);
        const aliasMatch = html.match(/賬戶化名<\/td>\s*<td>(.*?)<\/td>/);
        const userAlias = aliasMatch ? aliasMatch[1].trim() : '未知';
        return {
            date: new Date(Date.UTC(year, month - 1, day)),
            dateStr: `${String(year).slice(2)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            userAlias,
        };
    };

    const handleIbBatchImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        if (!fileList || fileList.length === 0) return;

        // Copy files BEFORE resetting input (FileList is a live reference)
        const allFiles: File[] = Array.from(fileList);
        event.target.value = ''; // Reset input after copying

        // Filter .htm/.html files
        const htmlFiles: File[] = [];
        for (const f of allFiles) {
            const lower = f.name.toLowerCase();
            if (lower.endsWith('.htm') || lower.endsWith('.html')) {
                htmlFiles.push(f);
            }
        }

        if (htmlFiles.length === 0) {
            toast({ variant: 'destructive', title: '未找到報表', description: '資料夾中沒有 .htm / .html 檔案' });
            return;
        }

        // Read all files and extract dates
        const parsed: Array<{ file: File; date: Date; dateStr: string; fileName: string; userAlias: string }> = [];
        const failedFiles: string[] = [];
        for (const f of htmlFiles) {
            try {
                const text = await f.text();
                const info = extractDateFromHtml(text);
                if (info) {
                    parsed.push({ file: f, date: info.date, dateStr: info.dateStr, fileName: f.name, userAlias: info.userAlias });
                } else {
                    failedFiles.push(f.name);
                }
            } catch {
                failedFiles.push(f.name);
            }
        }

        if (parsed.length === 0) {
            toast({ variant: 'destructive', title: '解析失敗', description: '所有檔案都無法解析日期' });
            return;
        }

        // Sort by date (oldest first)
        parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Check date continuity (skip weekends)
        const dateWarnings: string[] = [];
        for (let i = 1; i < parsed.length; i++) {
            const prev = parsed[i - 1].date;
            const curr = parsed[i].date;
            // Count business days between (exclusive of both endpoints)
            let businessDays = 0;
            const d = new Date(prev);
            d.setDate(d.getDate() + 1);
            while (d < curr) {
                const dow = d.getDay();
                if (dow !== 0 && dow !== 6) businessDays++;
                d.setDate(d.getDate() + 1);
            }
            if (businessDays > 0) {
                dateWarnings.push(`${parsed[i - 1].dateStr} → ${parsed[i].dateStr} 之間缺少 ${businessDays} 個交易日`);
            }
        }

        setBatchFiles(parsed);
        setBatchResults([]);
        setBatchError(null);
        setBatchDateWarnings(dateWarnings);
        setBatchImporting(false);
        setBatchProgress(0);
        setBatchMessage(
            failedFiles.length > 0
                ? `${failedFiles.length} 個檔案無法解析，已跳過`
                : ''
        );
        setBatchDialogOpen(true);
    };

    const confirmBatchImport = async () => {
        if (batchFiles.length === 0) return;
        setBatchImporting(true);
        setBatchProgress(0);
        setBatchResults([]);
        setBatchError(null);

        const results: Array<{ file: string; date: string; user: string; status: string }> = [];
        const total = batchFiles.length;

        for (let i = 0; i < total; i++) {
            const item = batchFiles[i];
            setBatchMessage(`正在處理 ${item.dateStr} (${i + 1}/${total})...`);
            setBatchProgress(Math.round((i / total) * 100));

            try {
                // 1. Import stock trades first
                try {
                    const stockFormData = new FormData();
                    stockFormData.append('file', item.file);
                    stockFormData.append('confirm', 'true');
                    await fetch('/api/stocks/import-ib', { method: 'POST', body: stockFormData });
                } catch {
                    // Stock import failure is non-fatal
                }

                // 2. Import net equity
                const formData = new FormData();
                formData.append('file', item.file);
                formData.append('confirm', 'true');

                const res = await fetch('/api/net-equity/import-ib', { method: 'POST', body: formData });
                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || '匯入失敗');
                }

                let statusText = data.yearStartUpdated ? '年初更新' : (data.action === 'updated' ? '更新' : '已匯入');
                if (data.positionsSync?.added) statusText += ` +${data.positionsSync.added}持倉`;
                if (data.openOptionsSync?.added) statusText += ` +${data.openOptionsSync.added}期權`;

                results.push({
                    file: item.fileName,
                    date: item.dateStr,
                    user: data.userName || item.userAlias || '未知',
                    status: `✓ ${statusText}`,
                });
                setBatchResults([...results]);

            } catch (error: any) {
                // Fail fast: stop immediately on error
                results.push({
                    file: item.fileName,
                    date: item.dateStr,
                    user: item.userAlias || '未知',
                    status: `✗ ${error.message}`,
                });
                setBatchResults([...results]);
                setBatchError(`${item.dateStr} (${item.fileName}) 匯入失敗：${error.message}`);
                setBatchProgress(Math.round(((i + 1) / total) * 100));
                setBatchImporting(false);
                return; // Stop processing
            }
        }

        // All done
        setBatchProgress(100);
        setBatchMessage(`完成！共匯入 ${results.length} 個報表`);
        setBatchImporting(false);
        fetchUsers(true);
    };

    // IB Statement Import Handlers
    const handleIbImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = ''; // Reset input

        try {
            // Parse net equity
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/net-equity/import-ib', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '解析失敗');
            }

            // Date validation: file must be newer than latest record
            if (data.latestRecordDate && data.parsed?.date && data.parsed.date <= data.latestRecordDate) {
                toast({
                    variant: "destructive",
                    title: "日期錯誤",
                    description: `此報表日期 (${data.parsed.dateStr}) 不晚於最新記錄 (${data.latestRecordDate})，請匯入更新的報表`,
                });
                return;
            }

            // Also parse stock trades
            let stockData = null;
            try {
                const stockFormData = new FormData();
                stockFormData.append('file', file);
                const stockRes = await fetch('/api/stocks/import-ib', {
                    method: 'POST',
                    body: stockFormData,
                });
                stockData = await stockRes.json();
                if (!stockRes.ok) stockData = null;
            } catch {
                // Stock trade parsing is optional
            }

            setIbImportPreview(data);
            setIbStockPreview(stockData);
            setIbImportFile(file);
            setIbImportDialogOpen(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "IB 報表解析失敗",
                description: error.message,
            });
        }
    };

    const confirmIbImport = async () => {
        if (!ibImportFile) return;
        setIbImporting(true);
        try {
            let stockMsg = '';
            // 1. Import stock trades FIRST (so position sync can find existing records)
            if (ibStockPreview?.actions?.length > 0) {
                try {
                    const stockFormData = new FormData();
                    stockFormData.append('file', ibImportFile);
                    stockFormData.append('confirm', 'true');
                    const stockRes = await fetch('/api/stocks/import-ib', {
                        method: 'POST',
                        body: stockFormData,
                    });
                    const stockData = await stockRes.json();
                    if (stockRes.ok) {
                        const parts = [];
                        if (stockData.created) parts.push(`開倉 ${stockData.created}`);
                        if (stockData.closed) parts.push(`平倉 ${stockData.closed}`);
                        if (stockData.split) parts.push(`拆單 ${stockData.split}`);
                        if (parts.length > 0) stockMsg = `，股票：${parts.join('、')}`;
                    }
                } catch {
                    // Stock import failure is non-fatal
                }
            }

            // 2. Import net equity
            const formData = new FormData();
            formData.append('file', ibImportFile);
            formData.append('confirm', 'true');

            const res = await fetch('/api/net-equity/import-ib', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || '匯入失敗');
            }

            // Build positions sync message
            let posMsg = '';
            if (data.positionsSync) {
                const ps = data.positionsSync;
                if (ps.added) posMsg = `，持倉：新增 ${ps.added}`;
            }
            if (data.openOptionsSync) {
                const os = data.openOptionsSync;
                if (os.added) posMsg += `，期權持倉：新增 ${os.added}`;
            }

            toast({
                title: "匯入成功",
                description: `${data.userName} ${data.dateStr} ${data.yearStartUpdated ? '年初起始已更新' : `淨值記錄已${data.action === 'updated' ? '更新' : '匯入'}`}${stockMsg}${posMsg}`,
            });

            setIbImportDialogOpen(false);
            setIbImportPreview(null);
            setIbStockPreview(null);
            setIbImportFile(null);
            fetchUsers(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "匯入失敗",
                description: error.message,
            });
        } finally {
            setIbImporting(false);
        }
    };

    const formatIbMoney = (val: number) => {
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    };

    const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

    const confirmDeleteAll = async () => {
        try {
            const res = await fetch(`/api/users?mode=all&year=${selectedYear}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '刪除失敗');
            }

            const data = await res.json();
            // Toast removed
            fetchUsers(true);
            setDeleteAllDialogOpen(false);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        }
    };

    const getRoleBadge = (role: string) => {
        switch (role) {
            case 'admin':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">系統管理員</Badge>;
            case 'manager':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">管理者</Badge>;
            case 'trader':
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">交易員</Badge>;
            default:
                return <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100 border border-slate-200">客戶</Badge>;
        }
    };

    if (loading) return <div className="p-8">載入中...</div>;

    const formatPhoneNumber = (phone?: string) => {
        if (!phone) return '-';
        // Remove all non-numeric characters
        const clean = phone.replace(/\D/g, '');
        // Check if it matches typical Taiwan mobile length (10 digits)
        if (clean.length === 10) {
            // Format as 09XX-XXXXXX
            return `${clean.slice(0, 4)}-${clean.slice(4)}`;
        }
        return phone;
    };

    const formatMoney = (val?: number) => {
        if (val === undefined || val === null) return '-';
        return new Intl.NumberFormat('en-US').format(Math.round(val));
    };

    return (
        <TooltipProvider delayDuration={300}>
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 用戶設定
                    </h1>
                    <div className="flex gap-2">
                        {/* Only show actions for admin/manager/trader, NOT customer */}
                        {currentUser?.role !== 'customer' && currentUser?.role !== 'trader' && (
                            <>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="hover:bg-accent hover:text-accent-foreground"
                                        >
                                            <HardDrive className="h-4 w-4 mr-2" />
                                            備份
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={handleExportClick}>
                                            <Upload className="h-4 w-4 mr-2" />
                                            匯出
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => jsonImportRef.current?.click()} disabled={importing}>
                                            <Download className="h-4 w-4 mr-2" />
                                            匯入
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <input
                                    ref={jsonImportRef}
                                    type="file"
                                    accept=".json"
                                    onChange={handleImportFile}
                                    className="hidden"
                                    disabled={importing}
                                />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="hover:bg-accent hover:text-accent-foreground"
                                        >
                                            <FileUp className="h-4 w-4 mr-2" />
                                            匯入報表
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => singleFileInputRef.current?.click()}>
                                            <FileUp className="h-4 w-4 mr-2" />
                                            檔案
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => dirInputRef.current?.click()}>
                                            <FolderOpen className="h-4 w-4 mr-2" />
                                            資料夾
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <input
                                    ref={singleFileInputRef}
                                    type="file"
                                    accept=".htm,.html"
                                    onChange={handleIbImportFile}
                                    className="hidden"
                                />
                                <input
                                    ref={dirInputRef}
                                    type="file"
                                    {...{ webkitdirectory: '', directory: '' } as any}
                                    onChange={handleIbBatchImport}
                                    className="hidden"
                                />
                                {selectedYear !== 'All' && (
                                    <Button
                                        onClick={() => setDeleteAllDialogOpen(true)}
                                        variant="outline"
                                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        刪除全部
                                    </Button>
                                )}
                                <Button
                                    onClick={() => { setEditingUser(null); setDialogOpen(true); }}
                                    variant="secondary"
                                    className="hover:bg-accent hover:text-accent-foreground"
                                >
                                    <span className="mr-0.5">+</span>新增
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-secondary hover:bg-secondary">
                                <TableHead className="w-[50px] text-center">#</TableHead>
                                <TableHead className="text-center">角色</TableHead>
                                <TableHead className="text-center">帳號</TableHead>
                                <TableHead className="text-center">管理費率</TableHead>
                                <TableHead className="text-center">管理費預估</TableHead>

                                <TableHead className="text-center">當前淨值</TableHead>
                                <TableHead className="text-center">IB 帳號</TableHead>
                                <TableHead className="text-center">手機號碼</TableHead>
                                <TableHead>郵件地址</TableHead>
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(() => {
                                const filteredUsers = users.filter(u => u.email !== 'admin');
                                if (filteredUsers.length === 0) {
                                    return (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={10} className="p-4">
                                                <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
                                                    尚無客戶資料
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                }

                                const sortedUsers = [...filteredUsers].sort((a, b) => {
                                    const equityA = a.current_net_equity || 0;
                                    const equityB = b.current_net_equity || 0;
                                    return equityB - equityA;
                                });

                                // Calculate totals
                                const totalEstimatedFee = sortedUsers.reduce((sum, user) => {
                                    if (user.role === 'customer' && (user.management_fee ?? 0) > 0) {
                                        const currentEquity = user.current_net_equity || 0;
                                        const fee = ((user.management_fee ?? 0) / 100) * currentEquity;
                                        return sum + fee;
                                    }
                                    return sum;
                                }, 0);

                                const totalCurrentEquity = sortedUsers.reduce((sum, user) => {
                                    if (user.role === 'customer') {
                                        return sum + (user.current_net_equity || 0);
                                    }
                                    return sum;
                                }, 0);

                                return [
                                    ...sortedUsers.map((user, index) => {
                                        const currentEquity = user.current_net_equity || 0;
                                        const estimatedFee = user.role === 'customer' && (user.management_fee ?? 0) > 0
                                            ? ((user.management_fee ?? 0) / 100) * currentEquity
                                            : 0;
                                        return (
                                            <TableRow key={user.id}>
                                                <TableCell className="text-center text-muted-foreground font-mono">{index + 1}</TableCell>
                                                <TableCell className="text-center">{getRoleBadge(user.role)}</TableCell>
                                                <TableCell className="text-center">{user.user_id || '-'}</TableCell>
                                                <TableCell className={`text-center ${user.role === 'customer' && user.management_fee === 0 ? 'bg-pink-50' : ''}`}>
                                                    {user.role === 'customer' ? (
                                                        user.management_fee === 0 ? '不收費' : `${user.management_fee}%`
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {user.role === 'customer' && (user.management_fee ?? 0) > 0 ? formatMoney(estimatedFee) : '-'}
                                                </TableCell>

                                                <TableCell className="text-center">{user.role === 'customer' ? formatMoney(currentEquity) : '-'}</TableCell>
                                                <TableCell className="text-center">{user.role === 'customer' ? (user.ib_account || '-') : '-'}</TableCell>
                                                <TableCell className="text-center">{formatPhoneNumber(user.phone)}</TableCell>
                                                <TableCell>{user.email}</TableCell>
                                                <TableCell className="text-right">
                                                    {currentUser?.role !== 'trader' && currentUser?.role !== 'customer' && (
                                                        <div className="flex justify-end gap-1">
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => handleEdit(user)}
                                                                        className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                                    >
                                                                        <Pencil className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>編輯</p>
                                                                </TooltipContent>
                                                            </Tooltip>

                                                            {user.role === 'customer' && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => handleGenerateReport(user.id)}
                                                                            className="text-muted-foreground hover:text-blue-600 hover:bg-blue-50"
                                                                            disabled={isGeneratingReport}
                                                                        >
                                                                            <FileText className="h-4 w-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>生成報告</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}

                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        onClick={() => handleDelete(user.id)}
                                                                        className="text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p>刪除</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    }),
                                    // Summary row
                                    <TableRow key="summary" className="bg-secondary/50 border-t-2">
                                        <TableCell className="text-center">總計</TableCell>
                                        <TableCell colSpan={3} className="text-center"></TableCell>
                                        <TableCell className="text-center">{formatMoney(totalEstimatedFee)}</TableCell>
                                        <TableCell className="text-center">{formatMoney(totalCurrentEquity)}</TableCell>
                                        <TableCell colSpan={4}></TableCell>
                                    </TableRow>
                                ];
                            })()}
                        </TableBody>
                    </Table>
                </div>

                <Dialog open={reportDialog?.open || false} onOpenChange={(open) => !open && setReportDialog(null)}>
                    <DialogContent className="w-[400px] max-w-[90vw]">
                        <DialogHeader>
                            <div className="flex items-center gap-2">
                                <DialogTitle>用戶報告</DialogTitle>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => {
                                        if (reportDialog?.report) {
                                            navigator.clipboard.writeText(reportDialog.report);
                                            toast({
                                                title: "已複製",
                                                description: "報告已複製到剪貼簿",
                                            });
                                        }
                                    }}
                                >
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </div>
                        </DialogHeader>
                        <Textarea
                            value={reportDialog?.report || ''}
                            readOnly
                            className="font-mono text-xs min-h-[450px] resize-none"
                        />
                    </DialogContent>
                </Dialog>

                <AdminUserDialog
                    open={dialogOpen}
                    onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setEditingUser(null);
                    }}
                    onSuccess={fetchUsers}
                    userToEdit={editingUser}
                />

                <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確定要刪除 {users.find(u => u.id === userToDelete)?.user_id || users.find(u => u.id === userToDelete)?.email || '此使用者'} 帳戶嗎？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                此操作無法復原。這將永久刪除此使用者帳號及其所有相關資料。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                                刪除
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確定要刪除 {selectedYear} 年度的所有使用者嗎？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                此操作無法復原。這將永久刪除該年度的所有使用者資料（除了您自己的帳號）。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmDeleteAll} className="bg-red-600 hover:bg-red-700">
                                確認刪除全部
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <UserSelectionDialog
                    open={exportSelectionOpen}
                    onOpenChange={setExportSelectionOpen}
                    title={`選擇${selectedYear === 'All' ? '' : selectedYear}要匯出的使用者`}
                    users={selectionUsers}
                    onConfirm={confirmExport}
                    confirmLabel="開始匯出"
                    // New Props for Export Progress
                    processing={exportProcessing}
                    progress={exportProgress}
                    preventCloseOnConfirm={true}
                    dependencies={{
                        'options_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        },
                        'interest_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        },
                        'fees_records': {
                            satisfied: (selected) => Array.from(selected).some(id => typeof id === 'number')
                        }
                    }}
                />
                <UserSelectionDialog
                    open={importSelectionOpen}
                    onOpenChange={(open) => {
                        setImportSelectionOpen(open);
                        if (!open) {
                            // Reset state only when strictly closed
                            setImportProcessing(false);
                            setImportProgress(0);
                            setCompletedImportIds([]);
                            setPendingImportData(null);
                            setSelectionUsers([]);
                        }
                    }}
                    title={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "無法匯入：年份不符"
                            : `選擇${pendingImportData?.sourceYear || ''}要匯入的使用者`
                    }
                    description={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? `匯入檔案年份 (${pendingImportData.sourceYear}) 與目前檢視年份 (${selectedYear}) 不符。為了確保數據一致性，請切換至正確年份後再進行匯入。`
                            : undefined
                    }
                    users={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? [] // Empty
                            : selectionUsers
                    }
                    hideList={!!(pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear))}
                    onlyConfirm={!!(pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear))}
                    onConfirm={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? (() => setImportSelectionOpen(false)) as any // Force cast if needed or adjust logic
                            : confirmImport
                    }
                    confirmLabel={
                        pendingImportData?.sourceYear && selectedYear !== 'All' && String(pendingImportData.sourceYear) !== String(selectedYear)
                            ? "我知道了"
                            : "開始匯入"
                    }
                    // New Props
                    processing={importProcessing}
                    progress={importProgress}
                    completedIds={completedImportIds}
                    preventCloseOnConfirm={true} // Keep open for processing
                    dependencies={{
                        'options_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records')
                        },
                        'interest_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records' && id !== 'fees_records')
                        },
                        'fees_records': {
                            satisfied: (selected) => Array.from(selected).some(id => id !== 'market_data' && id !== 'options_records' && id !== 'interest_records' && id !== 'fees_records')
                        }
                    }}
                />

                {/* IB Statement Import Confirmation Dialog */}
                <AlertDialog open={ibImportDialogOpen} onOpenChange={(open) => {
                    if (!open) {
                        setIbImportDialogOpen(false);
                        setIbImportPreview(null);
                        setIbStockPreview(null);
                        setIbImportFile(null);
                    }
                }}>
                    <AlertDialogContent className="max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確認匯入 IB 報表：{ibImportPreview?.parsed?.userName} ({ibImportPreview?.parsed?.dateStr})
                            </AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="space-y-3" style={{ color: '#1e293b' }}>
                                    {ibImportPreview?.parsed && (
                                        <>

                                            <table className="w-full text-xs border rounded">
                                                <thead>
                                                    <tr className="bg-muted">
                                                        <th className="text-left p-1.5">欄位</th>
                                                        <th className="text-right p-1.5">解析值</th>
                                                        {ibImportPreview.existing && <th className="text-right p-1.5">現有值</th>}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr className="border-t">
                                                        <td className="p-1.5">帳戶淨值</td>
                                                        <td className="text-right p-1.5 font-mono">{formatIbMoney(ibImportPreview.parsed.netEquity)}</td>
                                                        {ibImportPreview.existing && <td className="text-right p-1.5 font-mono text-muted-foreground">{formatIbMoney(ibImportPreview.existing.netEquity)}</td>}
                                                    </tr>
                                                    <tr className="border-t">
                                                        <td className="p-1.5">帳戶現金</td>
                                                        <td className="text-right p-1.5 font-mono">{formatIbMoney(ibImportPreview.parsed.cashBalance)}</td>
                                                        {ibImportPreview.existing && <td className="text-right p-1.5 font-mono text-muted-foreground">{formatIbMoney(ibImportPreview.existing.cashBalance)}</td>}
                                                    </tr>
                                                    <tr className="border-t">
                                                        <td className="p-1.5">應計利息</td>
                                                        <td className="text-right p-1.5 font-mono">{formatIbMoney(ibImportPreview.parsed.interest)}</td>
                                                        {ibImportPreview.existing && <td className="text-right p-1.5 font-mono text-muted-foreground">{formatIbMoney(ibImportPreview.existing.interest)}</td>}
                                                    </tr>
                                                    <tr className="border-t">
                                                        <td className="p-1.5">顧問費用</td>
                                                        <td className="text-right p-1.5 font-mono">{formatIbMoney(ibImportPreview.parsed.managementFee)}</td>
                                                        {ibImportPreview.existing && <td className="text-right p-1.5 font-mono text-muted-foreground">{formatIbMoney(ibImportPreview.existing.managementFee)}</td>}
                                                    </tr>
                                                    {(ibImportPreview.parsed.deposit !== 0 || ibImportPreview.existing?.deposit !== 0) && (
                                                        <tr className="border-t">
                                                            <td className="p-1.5">存款和取款</td>
                                                            <td className="text-right p-1.5 font-mono">{formatIbMoney(ibImportPreview.parsed.deposit)}</td>
                                                            {ibImportPreview.existing && <td className="text-right p-1.5 font-mono text-muted-foreground">{formatIbMoney(ibImportPreview.existing.deposit)}</td>}
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>

                                            {ibImportPreview.parsed.isYearStart && (
                                                <p className="text-xs text-blue-600 bg-blue-50 px-2 py-1.5 rounded">
                                                    📌 此為 1/1 報表，將同步更新年初起始數據
                                                </p>
                                            )}




                                        </>
                                    )}

                                    {/* Stock Trade Actions + New Position Sync */}
                                    {(() => {
                                        const stockActionSymbols = new Set(ibStockPreview?.actions?.map((a: any) => a.symbol) || []);
                                        const filteredPositionActions = (ibImportPreview?.parsed?.positionActions || []).filter((pos: any) => !stockActionSymbols.has(pos.symbol));
                                        const hasActions = (ibStockPreview?.actions?.length > 0) || filteredPositionActions.length > 0;

                                        if (!hasActions) return ibStockPreview?.trades?.length === 0 ? (
                                            <div className="text-xs text-muted-foreground">報表中無股票交易記錄</div>
                                        ) : null;

                                        return (
                                            <>
                                                <table className="w-full text-xs border rounded">
                                                    <thead>
                                                        <tr className="bg-muted">
                                                            <th className="text-left p-1.5">操作</th>
                                                            <th className="text-left p-1.5">代碼</th>
                                                            <th className="text-right p-1.5">數量</th>
                                                            <th className="text-right p-1.5">價格</th>
                                                            <th className="text-right p-1.5">說明</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ibStockPreview?.actions?.map((action: any, i: number) => (
                                                            <tr key={`stock-${i}`} className="border-t">
                                                                <td className="p-1.5">
                                                                    {action.type === 'open' && <span className="text-green-600">開倉</span>}
                                                                    {action.type === 'close_full' && <span className="text-red-600">平倉</span>}
                                                                    {action.type === 'close_split' && <span className="text-orange-600">拆單平倉</span>}
                                                                </td>
                                                                <td className="p-1.5 font-mono">{action.symbol}</td>
                                                                <td className="text-right p-1.5 font-mono">{action.quantity.toLocaleString()}</td>
                                                                <td className="text-right p-1.5 font-mono">{action.price.toFixed(2)}</td>
                                                                <td className="p-1.5 text-right text-muted-foreground">
                                                                    {action.type === 'open' && '新增持倉'}
                                                                    {action.type === 'close_full' && `(${action.existingCode}) ${action.existingQuantity}股全平`}
                                                                    {action.type === 'close_split' && `(${action.existingCode}) ${action.existingQuantity}→${action.remainingQuantity}股`}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {filteredPositionActions.map((pos: any, i: number) => (
                                                            <tr key={`pos-${i}`} className="border-t">
                                                                <td className="p-1.5">
                                                                    <span className="text-blue-600">同步持倉</span>
                                                                </td>
                                                                <td className="p-1.5 font-mono">{pos.symbol}</td>
                                                                <td className="text-right p-1.5 font-mono">{pos.quantity.toLocaleString()}</td>
                                                                <td className="text-right p-1.5 font-mono">{pos.costPrice.toFixed(2)}</td>
                                                                <td className="p-1.5 text-right text-muted-foreground">新增</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </>
                                        );
                                    })()}

                                    {/* Open Option Position Sync */}
                                    {ibImportPreview?.parsed?.openOptionActions?.filter((a: any) => a.action === 'sync_add')?.length > 0 && (
                                        <table className="w-full text-xs border rounded">
                                            <thead>
                                                <tr className="bg-muted">
                                                    <th className="text-left p-1.5">操作</th>
                                                    <th className="text-left p-1.5">標的</th>
                                                    <th className="text-left p-1.5">類型</th>
                                                    <th className="text-right p-1.5">行權價</th>
                                                    <th className="text-right p-1.5">到期日</th>
                                                    <th className="text-right p-1.5">口數</th>
                                                    <th className="text-right p-1.5">權利金</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ibImportPreview.parsed.openOptionActions.filter((a: any) => a.action === 'sync_add').map((pos: any, i: number) => (
                                                    <tr key={`oopt-${i}`} className="border-t">
                                                        <td className="p-1.5">
                                                            <span className="text-blue-600">同步持倉</span>
                                                        </td>
                                                        <td className="p-1.5 font-mono">{pos.underlying}</td>
                                                        <td className="p-1.5">
                                                            <span className={pos.type === 'CALL' ? 'text-green-600' : 'text-red-600'}>
                                                                {pos.type}
                                                            </span>
                                                        </td>
                                                        <td className="text-right p-1.5 font-mono">{pos.strikePrice}</td>
                                                        <td className="text-right p-1.5 font-mono">{pos.toDateStr}</td>
                                                        <td className="text-right p-1.5 font-mono">{pos.quantity}</td>
                                                        <td className="text-right p-1.5 font-mono">${pos.premium.toFixed(0)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}

                                    {/* Option Trade Actions */}
                                    {ibImportPreview?.parsed?.optionActions?.length > 0 && (
                                        <table className="w-full text-xs border rounded">
                                            <thead>
                                                <tr className="bg-muted">
                                                    <th className="text-left p-1.5">操作</th>
                                                    <th className="text-left p-1.5">標的</th>
                                                    <th className="text-left p-1.5">類型</th>
                                                    <th className="text-right p-1.5">行權價</th>
                                                    <th className="text-right p-1.5">到期日</th>
                                                    <th className="text-right p-1.5">口數</th>
                                                    <th className="text-right p-1.5">權利金</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ibImportPreview.parsed.optionActions.map((opt: any, i: number) => (
                                                    <tr key={`opt-${i}`} className={`border-t ${opt.action === 'skip_close' ? 'opacity-40' : opt.action === 'skip_exists' ? 'opacity-60' : ''}`}>
                                                        <td className="p-1.5">
                                                            {opt.action === 'add' && <span className="text-green-600">新增期權</span>}
                                                            {opt.action === 'close' && <span className="text-red-600">平倉</span>}
                                                            {opt.action === 'assign' && <span className="text-purple-600">指派</span>}
                                                            {opt.action === 'expire' && <span className="text-gray-500">到期</span>}
                                                            {opt.action === 'close_orphan' && <span className="text-orange-600" title="找不到對應的開倉記錄">平倉(無對應)</span>}
                                                            {opt.action === 'assign_orphan' && <span className="text-orange-600" title="找不到對應的開倉記錄">指派(無對應)</span>}
                                                            {opt.action === 'expire_orphan' && <span className="text-orange-600" title="找不到對應的開倉記錄">到期(無對應)</span>}
                                                            {opt.action === 'skip_exists' && <span className="text-muted-foreground">已存在</span>}
                                                            {opt.action === 'skip_close' && <span className="text-muted-foreground">平倉(跳過)</span>}
                                                        </td>
                                                        <td className="p-1.5 font-mono">{opt.underlying}</td>
                                                        <td className="p-1.5">
                                                            <span className={opt.type === 'CALL' ? 'text-green-600' : 'text-red-600'}>
                                                                {opt.type}
                                                            </span>
                                                        </td>
                                                        <td className="text-right p-1.5 font-mono">{opt.strikePrice}</td>
                                                        <td className="text-right p-1.5 font-mono">{opt.toDateStr}</td>
                                                        <td className="text-right p-1.5 font-mono">{opt.quantity}</td>
                                                        <td className="text-right p-1.5 font-mono">${opt.premium.toFixed(0)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}

                                    {ibStockPreview?.warnings?.length > 0 && (
                                        <div className="text-red-600 text-xs space-y-1">
                                            {ibStockPreview.warnings.map((w: string, i: number) => (
                                                <p key={i}>{w}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmIbImport} disabled={ibImporting}>
                                {ibImporting ? '匯入中...' : '確認匯入'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Batch IB Import Dialog */}
                <AlertDialog open={batchDialogOpen} onOpenChange={(open) => {
                    if (!open && !batchImporting) {
                        setBatchDialogOpen(false);
                        setBatchFiles([]);
                        setBatchResults([]);
                        setBatchError(null);
                    }
                }}>
                    <AlertDialogContent className="max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                {batchImporting
                                    ? '批量匯入中...'
                                    : batchResults.length > 0
                                        ? (batchError ? '匯入中斷' : '匯入完成')
                                        : `批量匯入確認 (${batchFiles.length} 個檔案)`
                                }
                            </AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="space-y-3" style={{ color: '#1e293b' }}>
                                    {/* Pre-import summary */}
                                    {batchResults.length === 0 && !batchImporting && batchFiles.length > 0 && (
                                        <>
                                            <p className="text-sm">
                                                日期範圍：<span className="font-mono font-medium">{batchFiles[0]?.dateStr}</span> → <span className="font-mono font-medium">{batchFiles[batchFiles.length - 1]?.dateStr}</span>
                                            </p>
                                            <p className="text-sm">
                                                用戶：{[...new Set(batchFiles.map(f => f.userAlias))].join('、')}
                                            </p>
                                            {batchMessage && (
                                                <p className="text-xs text-orange-600 bg-orange-50 px-2 py-1.5 rounded">
                                                    ⚠ {batchMessage}
                                                </p>
                                            )}
                                            {batchDateWarnings.length > 0 && (
                                                <div className="text-xs text-orange-600 bg-orange-50 px-2 py-1.5 rounded space-y-0.5">
                                                    <p className="font-medium">⚠ 日期不連續：</p>
                                                    {batchDateWarnings.map((w, i) => (
                                                        <p key={i}>&nbsp;&nbsp;• {w}</p>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Progress */}
                                    {(batchImporting || batchResults.length > 0) && (
                                        <>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                    <span>{batchMessage}</span>
                                                    <span>{batchProgress}%</span>
                                                </div>
                                                <div className="w-full bg-secondary rounded-full h-2">
                                                    <div
                                                        className={`h-2 rounded-full transition-all duration-300 ${batchError ? 'bg-red-500' : 'bg-primary'}`}
                                                        style={{ width: `${batchProgress}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Results table */}
                                            {batchResults.length > 0 && (
                                                <div className="max-h-[300px] overflow-y-auto">
                                                    <table className="w-full text-xs border rounded">
                                                        <thead>
                                                            <tr className="bg-muted">
                                                                <th className="text-left p-1.5">日期</th>
                                                                <th className="text-left p-1.5">用戶</th>
                                                                <th className="text-left p-1.5">結果</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {batchResults.map((r, i) => (
                                                                <tr key={i} className={`border-t ${r.status.startsWith('✗') ? 'bg-red-50' : ''}`}>
                                                                    <td className="p-1.5 font-mono">{r.date}</td>
                                                                    <td className="p-1.5">{r.user}</td>
                                                                    <td className="p-1.5">{r.status}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}

                                            {batchError && (
                                                <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded">
                                                    ❌ {batchError}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            {!batchImporting && (
                                <Button variant="outline" onClick={() => {
                                    setBatchDialogOpen(false);
                                    setBatchFiles([]);
                                    setBatchResults([]);
                                    setBatchError(null);
                                }}>{batchResults.length > 0 ? '關閉' : '取消'}</Button>
                            )}
                            {batchResults.length === 0 && !batchImporting && (
                                <Button onClick={confirmBatchImport}>
                                    開始匯入
                                </Button>
                            )}
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <ProgressDialog
                    open={progressOpen}
                    title="處理中"
                    description={progressMessage}
                    progress={progressValue}
                    onConfirm={progressValue === 100 ? () => setProgressOpen(false) : undefined}
                />
            </div>
        </TooltipProvider >
    );
}
