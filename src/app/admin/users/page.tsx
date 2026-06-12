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
import { Pencil, Trash2, Download, Upload, Wallet, DollarSign, FileText, Copy, FileUp, FolderOpen, HardDrive, Check, Eraser, Mail } from "lucide-react";
import { useYearFilter } from '@/contexts/YearFilterContext';
import { useAdminSettings } from '@/contexts/AdminSettingsContext';
import { UserSelectionDialog } from "@/components/UserSelectionDialog";
import { ProgressDialog } from "@/components/ProgressDialog";
import { ArchiveImportDialog } from "@/components/ArchiveImportDialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { isMarketHoliday } from '@/lib/holidays';
import { calculatePremiumRate, calculateAnnualPremium, getPremiumCostBase } from '@/lib/options-metrics';
import { generateDailyTradesText } from '@/lib/daily-trades-text';

// Compose the BCC-only extras block based on admin settings. Returns
// an empty string when nothing opt-in produced content (so the API
// falls back to its single-email path). The shared cache lets callers
// fetch /api/daily-trades once and reuse it across users.
interface DailyTradesCache { date: string; data: any[]; marketData: Record<string, number> }
function buildBccExtras(
    user: { id: number; report_note?: string | null } | undefined,
    options: { includeTradeAdvice: boolean; includeDailyOps: boolean },
    dailyTrades: DailyTradesCache | null,
): string {
    if (!user) return '';
    const parts: string[] = [];
    if (options.includeTradeAdvice) {
        const note = (user.report_note || '').trim();
        if (note) parts.push(`交易建議\n${note}`);
    }
    if (options.includeDailyOps && dailyTrades) {
        const group = (dailyTrades.data || []).find((g: any) => g.user?.id === user.id);
        if (group) {
            // Drop the "交易日期 : ..." header (and its trailing dash rule)
            // because the parent email already shows the date in the subject
            // and 帳戶報告 body. Keep the call's `date` arg populated so the
            // DTE calculation inside generateDailyTradesText still works.
            const txt = generateDailyTradesText(group, dailyTrades.date, dailyTrades.marketData)
                .replace(/^交易日期 : [^\n]*\n-+\n/, '')
                .trim();
            if (txt) {
                // Sum every 收益 AND 權利金 amount the report renders → day's
                // total realized profit. Same pattern as the daily-trades card
                // header so the BCC extras header agrees with the UI.
                let dayProfit = 0;
                for (const m of txt.matchAll(/(?:收益|權利金)\s*([+-]?[\d,]+(?:\.\d+)?)/g)) {
                    dayProfit += parseFloat(m[1].replace(/,/g, ''));
                }
                const profitStr = `${dayProfit > 0 ? '+' : ''}${dayProfit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
                parts.push(`當日操作 - 總收益 ${profitStr}\n${txt}`);
            }
        }
    }
    // Join with a dash separator so the HTML renderer collapses it into
    // an <hr> (and consumes surrounding blank lines), keeping 當日操作
    // flush against 交易建議 instead of leaving a tall gap.
    return parts.join('\n----------------------------------------\n');
}


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
    trade_groups_count?: number;
    strategies_count?: number;
    start_date?: string;
    fee_exempt_months?: number;
    account_capability?: string;
    operation_mode?: string;
    open_otm_premium?: number;
    open_itm_final_profit?: number;
    open_all_final_profit?: number;
    report_note?: string;
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
    const [userToClear, setUserToClear] = useState<number | null>(null);
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
    const [selectedUserId, setSelectedUserId] = useState<number | 'All'>('All');

    // In-Dialog Progress State (Import)
    const [importProcessing, setImportProcessing] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [completedImportIds, setCompletedImportIds] = useState<(number | string)[]>([]);

    // In-Dialog Progress State (Export)
    const [exportProcessing, setExportProcessing] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Report Generation State
    const [reportDialog, setReportDialog] = useState<{ open: boolean; userId: number; userName: string; report: string } | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const [userReports, setUserReports] = useState<Map<number, { userName: string; report: string }>>(new Map());
    const [isLoadingReports, setIsLoadingReports] = useState(false);
    const [sendingMailUserId, setSendingMailUserId] = useState<number | null>(null);

    // Batch Mail State
    const [batchMailOpen, setBatchMailOpen] = useState(false);
    const [batchMailProcessing, setBatchMailProcessing] = useState(false);
    const [batchMailProgress, setBatchMailProgress] = useState(0);
    const [batchMailCompletedIds, setBatchMailCompletedIds] = useState<(number | string)[]>([]);
    const [batchMailUsers, setBatchMailUsers] = useState<any[]>([]);

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
    const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
    const singleFileInputRef = useRef<HTMLInputElement>(null);
    const dirInputRef = useRef<HTMLInputElement>(null);
    const jsonImportRef = useRef<HTMLInputElement>(null);
    const reportNoteSaveTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const reportNotePending = useRef<Map<number, string>>(new Map());
    // Which user's report-note display has been clicked into edit mode.
    // null = every note is rendering as a styled div with inline pills;
    // a userId = that user's note swapped to a raw textarea for editing.
    const [editingNoteUserId, setEditingNoteUserId] = useState<number | null>(null);
    const editingNoteRef = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
        if (editingNoteUserId != null && editingNoteRef.current) {
            const el = editingNoteRef.current;
            el.focus();
            // Place caret at end on initial focus.
            const len = el.value.length;
            el.setSelectionRange(len, len);
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        }
    }, [editingNoteUserId]);

    const { toast } = useToast();
    const router = useRouter();
    const { selectedYear } = useYearFilter();
    const { settings } = useAdminSettings();

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
            const res = await fetch(`/api/users?year=${year}&t=${Date.now()}`);
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
                // Always refetch reports — the year may have changed and reports
                // are year-specific. Previous guard (userReports.size === 0) kept
                // stale data from the previous year visible after switching.
                fetchAllReports(data.users);
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

    // Re-fetch reports when premium target changes
    useEffect(() => {
        if (users.length > 0) {
            fetchAllReports(users);
        }
    }, [settings.premiumTargetPercent]);

    // Re-fetch reports when the 平倉費用 mode changes — formatUserReport
    // pipes settings.closeCostOnlyBreached through calculateAnnualPremium,
    // so the previously-cached report strings still hold the prior mode's
    // 期權收益率 until we rerun the format step.
    useEffect(() => {
        if (users.length > 0) {
            fetchAllReports(users);
        }
    }, [settings.closeCostOnlyBreached]);

    const saveReportNote = async (userId: number, val: string) => {
        try {
            const res = await fetch(`/api/users/${userId}/report-note`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportNote: val })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Mirror the saved value into local state. Without this, when
            // the styled note-display div re-mounts after blur it reads
            // u.report_note (still the pre-edit value) and "loses" what
            // the user just typed — they only see the new text after a
            // hard refresh, which feels like the save silently failed.
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, report_note: val } : u));
            if (reportNotePending.current.get(userId) === val) {
                reportNotePending.current.delete(userId);
            }
        } catch (err) {
            console.error('Failed to save report note', err);
            toast({ variant: "destructive", title: "儲存失敗", description: "每日報告註解未儲存，請重試" });
        }
    };

    const scheduleReportNoteSave = (userId: number, val: string) => {
        reportNotePending.current.set(userId, val);
        const existing = reportNoteSaveTimers.current.get(userId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            reportNoteSaveTimers.current.delete(userId);
            saveReportNote(userId, val);
        }, 800);
        reportNoteSaveTimers.current.set(userId, timer);
    };

    const flushReportNoteSave = async (userId: number, val: string) => {
        const existing = reportNoteSaveTimers.current.get(userId);
        if (existing) {
            clearTimeout(existing);
            reportNoteSaveTimers.current.delete(userId);
            await saveReportNote(userId, val);
        } else if (reportNotePending.current.has(userId)) {
            await saveReportNote(userId, val);
        }
    };

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (reportNotePending.current.size > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, []);

    // Fetch all user reports for cards
    const fetchAllReports = async (usersList: User[]) => {
        const nonAdminUsers = usersList.filter(u => u.email !== 'admin');
        if (nonAdminUsers.length === 0) {
            setUserReports(new Map());
            return;
        }
        setIsLoadingReports(true);
        const reportsMap = new Map<number, { userName: string; report: string }>();
        await Promise.all(nonAdminUsers.map(async (user) => {
            try {
                const res = await fetch(`/api/users/${user.id}/report?premiumTargetPercent=${settings.premiumTargetPercent}&year=${selectedYear}&closeCostOnlyBreached=${settings.closeCostOnlyBreached === true}&t=${Date.now()}`);
                const data = await res.json();
                if (data.success) {
                    const report = formatUserReport(data.reportData, user);
                    reportsMap.set(user.id, { userName: data.reportData.user_id || user.user_id || user.email, report });
                }
            } catch (e) {
                // skip failed
            }
        }));
        setUserReports(reportsMap);
        setIsLoadingReports(false);
    };

    const handleDelete = async (id: number) => {
        setUserToDelete(id);
    };

    const handleClearRecords = (id: number) => {
        setUserToClear(id);
    };

    const confirmClearRecords = async () => {
        if (!userToClear) return;

        try {
            const res = await fetch(`/api/users/${userToClear}?mode=clear_records`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to clear records');
            }

            toast({
                title: "已清除",
                description: `${users.find(u => u.id === userToClear)?.user_id || '使用者'} 的交易記錄已清除`,
            });
            fetchUsers(true);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "錯誤",
                description: error.message,
            });
        } finally {
            setUserToClear(null);
        }
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

    const formatUserReport = (data: any, user?: User) => {
        const formatMoney = (val: number) => new Intl.NumberFormat('en-US').format(Math.round(val));
        const formatPercent = (val: number) => `${(val * 100).toFixed(1)}%`;

        // Compute 期權收益率 from the same data the summary card uses so the
        // two surfaces never drift. The report API has its own interest calc
        // that can return 0 if its FRED fetch lands in a cold isolate (the
        // catch block doesn't backfill totalDailyInterest), which is what
        // caused scott.238 to see 4.63% in the report while the card showed
        // 4.33%. Sourcing put/call/stock from user.monthly_stats and
        // summing monthly interest matches OptionsSummaryPanel exactly.
        const monthly = (user as any)?.monthly_stats as Array<{
            put_profit?: number; call_profit?: number; stock_pnl?: number; interest?: number;
        }> | undefined;
        const monthlyInterest = monthly?.reduce((s, m) => s + (m.interest || 0), 0) || 0;
        const premiumInput = {
            monthly_stats: monthly,
            total_daily_interest: monthlyInterest,
            initial_cost: user?.initial_cost ?? null,
            net_deposit: user?.net_deposit ?? null,
            open_otm_premium: user?.open_otm_premium ?? 0,
            open_itm_final_profit: user?.open_itm_final_profit ?? 0,
            open_all_final_profit: user?.open_all_final_profit ?? 0,
        };
        const annualPremium = monthly
            ? calculateAnnualPremium(premiumInput, {
                includeStockDiff: settings.includeStockDiffInPremium !== false,
                closeCostOnlyBreached: settings.closeCostOnlyBreached === true,
            })
            : data.annualPremium;
        const costBase = monthly
            ? getPremiumCostBase(premiumInput) || data.premiumCostBase || data.cost2026
            : (data.premiumCostBase ?? data.cost2026);

        let report = '';
        if (data.lastUpdateDate) {
            const d = new Date(data.lastUpdateDate * 1000);
            const dateStr = `${d.getFullYear().toString().slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            report += `最後更新日 : ${dateStr}\n`;
            report += `----------------------------------------\n`;
        }
        const highestNetWorth = data.highestNetWorth || data.accountNetWorth;
        const isNewHigh = data.accountNetWorth > 0 && data.accountNetWorth >= highestNetWorth;
        const yearLabel = data.year ?? new Date().getFullYear();
        report += `帳戶淨值 : ${formatMoney(data.accountNetWorth)}${isNewHigh ? ' (新高)' : ''}\n`;
        report += `${yearLabel}成本 : ${formatMoney(data.cost2026)}\n`;
        report += `${yearLabel}淨利 : ${formatMoney(data.netProfit2026)}\n`;
        report += `帳上現金 : ${formatMoney(data.cashBalance)}\n`;
        report += `當日利息 : ${data.dailyInterest ? (Number(data.dailyInterest.toFixed(1)) === 0 ? '0' : data.dailyInterest.toFixed(1)) : '0'}\n`;
        report += `歷史最高 : ${formatMoney(highestNetWorth)}\n`;
        report += `----------------------------------------\n`;
        report += `年初至今 : ${formatPercent(data.ytdReturn)}\n`;
        report += `最大跌幅 : ${formatPercent(data.maxDrawdown)}\n`;
        report += `夏普比率 : ${data.sharpeRatio.toFixed(2)}\n`;
        report += `----------------------------------------\n`;

        // Stock positions
        if (data.stockPositions && data.stockPositions.length > 0) {
            data.stockPositions.forEach((pos: any) => {
                let extraInfo = [];
                if (pos.avg_cost) {
                    extraInfo.push(`成本 ${pos.avg_cost}`);
                }
                if ((pos.symbol === 'QQQ' || pos.symbol === 'QLD') && pos.current_price && data.accountNetWorth > 0) {
                    const positionValue = pos.quantity * pos.current_price;
                    const allocation = Math.round((positionValue / data.accountNetWorth) * 100);
                    extraInfo.push(`佔比 ${allocation}%`);
                }
                const infoStr = extraInfo.length > 0 ? ` (${extraInfo.join('，')})` : '';
                report += `${pos.symbol} ${formatMoney(pos.quantity)} 股${infoStr}\n`;
            });
            report += `----------------------------------------\n`;
        }

        // Calculate daily premium using user's start_date
        const countWeekdays = (start: Date): number => {
            const end = new Date();
            let count = 0;
            const d = new Date(start);
            while (d <= end) {
                const dow = d.getDay();
                if (dow !== 0 && dow !== 6) count++;
                d.setDate(d.getDate() + 1);
            }
            return count;
        };
        const userStartDate = data.startDate
            ? new Date(data.startDate)
            : new Date(new Date().getFullYear(), 0, 1);
        const tradingDays = countWeekdays(userStartDate);
        const dailyPremium = tradingDays > 0 ? annualPremium / tradingDays : 0;

        // Premium section
        // 含/不含平倉費用 — numerators come straight from the report API
        // (mode-independent: realized + open premium, minus breach-aware
        // close cost). When nothing is breached they read identical.
        if (data.premiumExCloseCost != null && data.premiumIncCloseCost != null) {
            report += `期權收益率 (含平倉費用) : ${calculatePremiumRate(data.premiumIncCloseCost, costBase).toFixed(2)}%\n`;
            report += `期權收益率 (不含平倉費用) : ${calculatePremiumRate(data.premiumExCloseCost, costBase).toFixed(2)}%\n`;
        }
        if (data.last25TradingDaysPremium != null) {
            const v = Math.round(data.last25TradingDaysPremium);
            report += `近25交易日現金流 : $${formatMoney(v)}\n`;
        }
        report += `每日期權收益 : $${formatMoney(dailyPremium)}\n`;
        report += `整年累積收益 : $${formatMoney(annualPremium)}\n`;
        report += `整年${settings.premiumTargetPercent}%目標 : $${formatMoney(data.annualTarget)}\n`;
        report += `----------------------------------------\n`;
        report += `潛在融資 : ${formatPercent(data.marginRate)}\n`;

        // Open options
        if (data.openOptions && data.openOptions.length > 0) {
            data.openOptions.forEach((opt: any) => {
                // to_date is Unix timestamp, convert to date string
                const expiryDate = opt.to_date ? new Date(opt.to_date * 1000) : null;
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                let desc = `${opt.underlying} - ${opt.type} ${opt.strike_price}`;
                if (expiryDate) {
                    const monthName = months[expiryDate.getMonth()];
                    const dayStr = String(expiryDate.getDate()).padStart(2, '0');
                    const yearStr = String(expiryDate.getFullYear()).slice(2);
                    const typeChar = opt.type === 'CALL' ? 'C' : 'P';
                    desc = `${opt.underlying} ${monthName}${dayStr}'${yearStr} ${opt.strike_price}${typeChar}`;
                }
                if (opt.trade_group) {
                    desc += ` (${opt.trade_group})`;
                }
                const isSeller = opt.quantity < 0;
                const quantityStr = isSeller ? opt.quantity : Math.abs(opt.quantity);
                report += `${quantityStr}口 ${desc}\n`;
            });
        }

        return report;
    };

    const handleGenerateReport = async (userId: number) => {
        setIsGeneratingReport(true);
        try {
            const res = await fetch(`/api/users/${userId}/report?premiumTargetPercent=${settings.premiumTargetPercent}&year=${selectedYear}&closeCostOnlyBreached=${settings.closeCostOnlyBreached === true}`);
            const data = await res.json();

            if (data.success) {
                const reportUser = users.find(u => u.id === userId);
                const report = formatUserReport(data.reportData, reportUser);
                setReportDialog({ open: true, userId, userName: data.reportData.user_id, report });
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

    const handleBatchMailClick = () => {
        // Build user list from userReports (only users with reports + valid email)
        const mailableUsers: { id: number | string; display: string; checked: boolean }[] = [];
        userReports.forEach(({ userName, report }, userId) => {
            const user = users.find(u => u.id === userId);
            if (!user) return;
            // Only include users with a valid email (contains @)
            if (!user.email || !user.email.includes('@')) return;
            mailableUsers.push({
                id: userId,
                display: `${userName} (${user.email})`,
                checked: true,
            });
        });

        if (mailableUsers.length === 0) {
            toast({ variant: 'destructive', title: '無可寄出的用戶', description: '沒有用戶擁有有效的 Email 和報告' });
            return;
        }

        setBatchMailUsers(mailableUsers);
        setBatchMailProcessing(false);
        setBatchMailProgress(0);
        setBatchMailCompletedIds([]);
        setBatchMailOpen(true);
    };

    const confirmBatchMail = async (selectedIds: (number | string)[]) => {
        setBatchMailProcessing(true);
        setBatchMailProgress(0);
        setBatchMailCompletedIds([]);

        const total = selectedIds.length;
        let succeeded = 0;
        let failed = 0;

        const ccEmailsBase = [
            settings.reportCcEnabled1 ? settings.reportCcEmail1 : null,
            settings.reportCcEnabled2 ? settings.reportCcEmail2 : null,
            settings.reportCcEnabled3 ? settings.reportCcEmail3 : null,
            settings.reportCcEnabled4 ? settings.reportCcEmail4 : null,
        ].filter(e => e && typeof e === 'string' && e.trim() !== '') as string[];

        // Fetch the latest /api/daily-trades once and reuse for every user
        // we send to. Only needed when at least one BCC-extras flag is on
        // AND we actually have BCC recipients.
        const needsExtras = ccEmailsBase.length > 0 &&
            ((settings.bccIncludeTradeAdvice !== false) || (settings.bccIncludeDailyOps !== false));
        let dailyTradesCache: DailyTradesCache | null = null;
        if (needsExtras && settings.bccIncludeDailyOps !== false) {
            try {
                const yearForFetch = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                const latestRes = await fetch(`/api/daily-trades/latest-date?year=${yearForFetch}`);
                const latestData = await latestRes.json().catch(() => ({}));
                const tradesDate = latestData.latestDate as string | undefined;
                if (tradesDate) {
                    const dailyRes = await fetch(`/api/daily-trades?date=${tradesDate}&year=${yearForFetch}`);
                    const dailyJson = await dailyRes.json().catch(() => ({}));
                    dailyTradesCache = { date: tradesDate, data: dailyJson.data || [], marketData: dailyJson.marketData || {} };
                }
            } catch (e) {
                console.warn('Failed to load daily-trades for BCC extras:', e);
            }
        }

        for (let i = 0; i < total; i++) {
            const userId = selectedIds[i] as number;
            const reportData = userReports.get(userId);
            if (!reportData) continue;

            try {
                const dateMatch = reportData.report.match(/最後更新日 : (\S+)/);
                const dateStr = dateMatch ? dateMatch[1] : '';
                const bccExtraReport = needsExtras
                    ? buildBccExtras(
                        users.find(u => u.id === userId),
                        {
                            includeTradeAdvice: settings.bccIncludeTradeAdvice !== false,
                            includeDailyOps: settings.bccIncludeDailyOps !== false,
                        },
                        dailyTradesCache,
                    )
                    : '';

                const res = await fetch('/api/users/send-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        report: reportData.report,
                        userName: reportData.userName,
                        dateStr,
                        ccEmails: ccEmailsBase,
                        bccExtraReport: bccExtraReport || undefined,
                    }),
                });
                if (res.ok) {
                    succeeded++;
                } else {
                    const data = await res.json();
                    failed++;
                    toast({ variant: 'destructive', title: `${reportData.userName} 發送失敗`, description: data.error || '未知錯誤' });
                }
            } catch {
                failed++;
                toast({ variant: 'destructive', title: `${reportData.userName} 發送失敗`, description: '網路錯誤' });
            }

            setBatchMailCompletedIds(prev => [...prev, userId]);
            setBatchMailProgress(Math.round(((i + 1) / total) * 100));
        }

        if (succeeded > 0) {
            toast({ title: '寄出完成', description: `成功 ${succeeded} 封${failed > 0 ? `，失敗 ${failed} 封` : ''}` });
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

        const totalTradeGroups = users
            .filter(u => u.email !== 'admin')
            .reduce((sum, u) => sum + (u.trade_groups_count || 0), 0);

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

        // Add Trade Groups Option
        exportableUsers.push({
            id: 'trade_groups',
            display: `交易群組 (${totalTradeGroups} 筆)`,
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
            const includeTradeGroups = selectedIds.includes('trade_groups');

            const realUserIds = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'trade_groups'
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
                    includeTradeGroups: includeTradeGroups
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
            a.download = `${data.count}_users_export_${dateStr}.json`;
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
            const totalTradeGroups = usersList.reduce((sum: number, u: any) => sum + (Array.isArray(u.trade_groups) ? u.trade_groups.length : 0), 0);

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

            // Check for Trade Groups choice
            importableUsers.push({
                id: 'trade_groups',
                display: `交易群組 (${totalTradeGroups} 筆)`,
                checked: totalTradeGroups > 0,
                disabled: totalTradeGroups === 0
            } as any);


            // Check for Market Data
            if (data.market_prices && data.market_prices.length > 0) {
                importableUsers.push({
                    id: 'market_data',
                    display: `歷史股價資料 (${data.market_prices.length} 筆)`,
                    checked: true
                });
            }

            // Check for Annotations
            const totalAnnotations = Array.isArray(data.annotations) ? data.annotations.length : 0;
            if (totalAnnotations > 0) {
                importableUsers.push({
                    id: 'annotations',
                    display: `註解資料 (${totalAnnotations} 筆)`,
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
            const importTradeGroups = selectedIds.includes('trade_groups');
            const importAnnotations = selectedIds.includes('annotations');

            const selectedUserEmails = selectedIds.filter(id =>
                id !== 'market_data' &&
                id !== 'options_records' &&
                id !== 'interest_records' &&
                id !== 'stock_trades' &&
                id !== 'fees_records' &&
                id !== 'trade_groups' &&
                id !== 'annotations'
            );

            const allUsers = pendingImportData.users || [];
            // Filter users based on selection
            const selectedUsers = allUsers.filter((u: any) => selectedUserEmails.includes(u.email));

            // Prepare Payload Structure
            const marketPrices = pendingImportData.market_prices || [];
            const sourceYear = pendingImportData.sourceYear;
            const targetYear = selectedYear === 'All' ? 'All' : selectedYear;

            // Scenario 1: Only non-user data selected (market data / annotations, no users)
            if (selectedUsers.length === 0 && (importMarketData || importAnnotations)) {
                setImportProgress(10);
                const payload: any = {
                    users: [],
                    market_prices: importMarketData ? marketPrices : [],
                    sourceYear: sourceYear
                };
                if (importAnnotations && pendingImportData.annotations) {
                    payload.annotations = pendingImportData.annotations;
                }
                const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
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
            // Step 0: Import market data & annotations in a separate request first
            const errors: string[] = [];
            if (importMarketData || importAnnotations) {
                setImportProgress(2);
                const globalPayload: any = {
                    users: [],
                    market_prices: importMarketData ? marketPrices : [],
                    sourceYear: sourceYear
                };
                if (importAnnotations && pendingImportData.annotations) {
                    globalPayload.annotations = pendingImportData.annotations;
                }
                try {
                    const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(globalPayload),
                    });
                    const result = await res.json();
                    if (!res.ok) {
                        errors.push(result.error || 'Market data / annotations import failed');
                    }
                    if (result.errors) errors.push(...result.errors);
                } catch (e: any) {
                    errors.push(`Market data import failed: ${e.message}`);
                }
                setCompletedImportIds(prev => {
                    const newIds = [...prev];
                    if (importMarketData) newIds.push('market_data');
                    if (importAnnotations) newIds.push('annotations');
                    return newIds;
                });
            }

            // Step 1: Import users — split each user's sub-data across multiple requests
            const TOTAL = selectedUsers.length;
            let processed = 0;

            for (let i = 0; i < TOTAL; i++) {
                const rawUser = selectedUsers[i];
                const userClone = { ...rawUser };
                if (!importOptions) delete userClone.options;
                if (!importStocks) delete userClone.stock_trades;
                if (!importTradeGroups) delete userClone.trade_groups;

                // Extract sub-records for chunked sending
                const allOptions = userClone.options || [];
                const allStocks = userClone.stock_trades || [];
                const allNetEquity = userClone.net_equity_records || [];

                // Sub-record batch size (keep each request small to avoid CPU limits)
                const SUB_BATCH = 10;

                // Build list of sub-requests for this user
                const subRequests: any[] = [];

                // Request 1: User profile + net equity (net equity uses batched INSERT OR IGNORE so it's efficient)
                const profileUser = { ...userClone, options: [], stock_trades: [] };
                subRequests.push(profileUser);

                // Additional requests for options in batches of SUB_BATCH
                for (let o = 0; o < allOptions.length; o += SUB_BATCH) {
                    const optChunk = allOptions.slice(o, o + SUB_BATCH);
                    subRequests.push({
                        ...userClone,
                        net_equity_records: [], deposits: [],
                        options: optChunk, stock_trades: [],
                        monthly_interest: [], monthly_fees: []
                    });
                }

                // Additional requests for stocks in batches of SUB_BATCH
                for (let s = 0; s < allStocks.length; s += SUB_BATCH) {
                    const stChunk = allStocks.slice(s, s + SUB_BATCH);
                    subRequests.push({
                        ...userClone,
                        net_equity_records: [], deposits: [],
                        options: [], stock_trades: stChunk,
                        monthly_interest: [], monthly_fees: []
                    });
                }



                // Send each sub-request sequentially
                for (const subUser of subRequests) {
                    try {
                        const chunkPayload: any = {
                            users: [subUser],
                            market_prices: [],
                            sourceYear: sourceYear
                        };

                        const res = await fetch(`/api/users/import?targetYear=${targetYear}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(chunkPayload),
                        });

                        const result = await res.json();

                        if (!res.ok) {
                            errors.push(result.error || `匯入失敗 (${rawUser.user_id || rawUser.email})`);
                        }

                        if (result.errors) errors.push(...result.errors);
                    } catch (e: any) {
                        errors.push(`匯入失敗 (${rawUser.user_id || rawUser.email}): ${e.message}`);
                    }
                }

                // Update Progress
                setCompletedImportIds(prev => {
                    const newIds = [...prev, rawUser.email];
                    if (importOptions && !prev.includes('options_records')) {
                        newIds.push('options_records');
                    }
                    if (importStocks && !prev.includes('stock_trades')) {
                        newIds.push('stock_trades');
                    }
                    if (importTradeGroups && !prev.includes('trade_groups')) {
                        newIds.push('trade_groups');
                    }
                    return newIds;
                });

                processed++;
                const progressPct = Math.round((processed / TOTAL) * 90);
                setImportProgress(progressPct);
            }

            // FORCE 100% to ensure UI unlocks
            setImportProgress(100);
            // Refresh list but keep dialog state stable until closed
            fetchUsers(true);

            if (errors.length > 0) {
                console.error('Import errors:', errors);
                const preview = errors.slice(0, 5).join('\n');
                const suffix = errors.length > 5 ? `\n...還有 ${errors.length - 5} 個錯誤（詳見 Console）` : '';
                toast({
                    variant: "destructive",
                    title: `匯入完成但有 ${errors.length} 個錯誤`,
                    description: preview + suffix,
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

    // Batch IB Import: Chinese month map for date extraction
    const BATCH_MONTH_MAP: Record<string, number> = {
        '一月': 1, '二月': 2, '三月': 3, '四月': 4,
        '五月': 5, '六月': 6, '七月': 7, '八月': 8,
        '九月': 9, '十月': 10, '十一月': 11, '十二月': 12
    };

    const extractDateFromHtml = (html: string): { date: Date; dateStr: string; userAlias: string } | null => {
        const titleMatch = html.match(/<title>.*?(?:活動賬單|活動總結)\s+([\u4e00-\u9fff]+)\s+(\d+),\s+(\d{4})/);
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

    const processBatchFiles = async (allFiles: File[]) => {
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
                if (dow !== 0 && dow !== 6 && !isMarketHoliday(d)) businessDays++;
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

    const handleIbBatchImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        if (!fileList || fileList.length === 0) return;

        // Copy files BEFORE resetting input (FileList is a live reference)
        const allFiles: File[] = Array.from(fileList);
        event.target.value = ''; // Reset input after copying
        
        await processBatchFiles(allFiles);
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
                let stockStats = '';
                try {
                    const stockFormData = new FormData();
                    stockFormData.append('file', item.file);
                    stockFormData.append('confirm', 'true');
                    const sRes = await fetch('/api/stocks/import-ib', { method: 'POST', body: stockFormData });
                    if (sRes.ok) {
                        const sData = await sRes.json();
                        const parts = [];
                        if (sData.created) parts.push(`+${sData.created}股票交易`);
                        if (sData.closed) parts.push(`-${sData.closed}股票平倉`);
                        if (parts.length > 0) stockStats = ' ' + parts.join(' ');
                    }
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

                // Append stock stats
                statusText += stockStats;

                // Append net equity / option stats
                if (data.positionsSync?.added) statusText += ` +${data.positionsSync.added}持倉`;
                if (data.openOptionsSync?.added || data.openOptionsSync?.updated) {
                    let text = [];
                    if (data.openOptionsSync.added) text.push(`新增${data.openOptionsSync.added}`);
                    if (data.openOptionsSync.updated) text.push(`更新${data.openOptionsSync.updated}`);
                    statusText += ` +期權持倉(${text.join(', ')})`;
                }
                if (data.optionsSync?.added) statusText += ` +${data.optionsSync.added}期權交易`;
                if (data.optionsSync?.closed) statusText += ` -${data.optionsSync.closed}期權平倉`;

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
    const processIbFile = async (file: File) => {
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

    const handleIbImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = ''; // Reset input
        await processIbFile(file);
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
                if (os.added || os.updated) {
                    let text = [];
                    if (os.added) text.push(`新增 ${os.added}`);
                    if (os.updated) text.push(`更新 ${os.updated}`);
                    posMsg += `，期權持倉：${text.join('、')}`;
                }
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
                return <Badge variant="secondary" className="bg-muted text-foreground hover:bg-muted border border-border">系統管理員</Badge>;
            case 'manager':
                return <Badge variant="secondary" className="bg-muted text-foreground hover:bg-muted border border-border">管理者</Badge>;
            case 'trader':
                return <Badge variant="secondary" className="bg-muted text-foreground hover:bg-muted border border-border">交易員</Badge>;
            default:
                return <Badge variant="secondary" className="bg-muted text-foreground hover:bg-muted border border-border">客戶</Badge>;
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
            <div className="container mx-auto py-10">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold">
                        {mounted ? (selectedYear === 'All' ? new Date().getFullYear() : selectedYear) : ''} 帳戶設定
                    </h1>
                    <div className="flex gap-2">
                        {/* Only show actions for admin/manager/trader, NOT customer */}
                        {currentUser?.role !== 'customer' && currentUser?.role !== 'trader' && (
                            <>
                                <Select
                                    value={selectedUserId === 'All' ? 'All' : selectedUserId.toString()}
                                    onValueChange={(val) => setSelectedUserId(val === 'All' ? 'All' : Number(val))}
                                >
                                    <SelectTrigger className="w-[150px] h-9 border-border shadow-xs">
                                        <SelectValue placeholder="所有帳號" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-none">
                                        <SelectItem value="All">所有帳號</SelectItem>
                                        {users.filter(u => u.email !== 'admin').map((u) => (
                                            <SelectItem key={u.id} value={u.id.toString()}>
                                                {u.user_id || u.email.split('@')[0]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Always render the button so the toolbar doesn't
                                    reflow when reports finish loading; disable it
                                    until at least one report is ready. */}
                                <Button
                                    variant="outline"
                                    className="font-normal hover:bg-accent hover:text-accent-foreground"
                                    onClick={handleBatchMailClick}
                                    disabled={isLoadingReports || userReports.size === 0}
                                >
                                    <Mail className="h-4 w-4 mr-2" />
                                    寄出報告
                                </Button>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="font-normal hover:bg-accent hover:text-accent-foreground"
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
                                            className="font-normal hover:bg-accent hover:text-accent-foreground"
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
                                        <DropdownMenuItem onClick={() => setArchiveDialogOpen(true)}>
                                            <FileText className="h-4 w-4 mr-2" />
                                            檔案庫
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
                                        className="font-normal hover:bg-destructive-soft hover:text-destructive hover:border-destructive-border"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        刪除全部
                                    </Button>
                                )}
                                <Button
                                    onClick={() => { setEditingUser(null); setDialogOpen(true); }}
                                    variant="secondary"
                                >
                                    <span className="mr-0.5">+</span>新增
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="bg-card rounded-lg shadow-sm border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px] text-center">#</TableHead>
                                <TableHead className="text-center">帳號</TableHead>
                                <TableHead className="text-center">操作模式</TableHead>
                                <TableHead className="text-center">IB 帳戶</TableHead>
                                <TableHead className="text-center">帳戶能力</TableHead>
                                <TableHead className="text-center">起始日期</TableHead>
                                <TableHead className="text-center">管理費率</TableHead>
                                <TableHead className="text-center">費用免除</TableHead>
                                <TableHead className="text-center">管理費預估</TableHead>
                                <TableHead className="text-center">當前淨值</TableHead>
                                {settings.showPhone && <TableHead className="text-center">手機號碼</TableHead>}
                                {settings.showEmail && <TableHead>郵件地址</TableHead>}
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(() => {
                                let filteredUsers = users.filter(u => u.email !== 'admin');
                                if (selectedUserId !== 'All') {
                                    filteredUsers = filteredUsers.filter(u => u.id === selectedUserId);
                                }
                                if (filteredUsers.length === 0) {
                                    return (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={12} className="p-4">
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
                                        let ratio = 1;
                                        if (user.start_date) {
                                            const start = new Date(user.start_date);
                                            const yearEnd = new Date(start.getFullYear(), 11, 31);
                                            const yearStart = new Date(start.getFullYear(), 0, 1);
                                            const totalDays = (yearEnd.getTime() - yearStart.getTime()) / 86400000 + 1;
                                            const remainingDays = (yearEnd.getTime() - start.getTime()) / 86400000 + 1;
                                            ratio = remainingDays / totalDays;
                                        }
                                        const exemptMonths = user.fee_exempt_months || 0;
                                        const exemptRatio = Math.max(0, 1 - exemptMonths / 12);
                                        const fee = ((user.management_fee ?? 0) / 100) * currentEquity * ratio * exemptRatio;
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
                                        let feeRatio = 1;
                                        if (user.start_date) {
                                            const start = new Date(user.start_date);
                                            const yearEnd = new Date(start.getFullYear(), 11, 31);
                                            const yearStart = new Date(start.getFullYear(), 0, 1);
                                            const totalDays = (yearEnd.getTime() - yearStart.getTime()) / 86400000 + 1;
                                            const remainingDays = (yearEnd.getTime() - start.getTime()) / 86400000 + 1;
                                            feeRatio = remainingDays / totalDays;
                                        }
                                        const estimatedFee = user.role === 'customer' && (user.management_fee ?? 0) > 0
                                            ? (() => {
                                                const exemptMonths = user.fee_exempt_months || 0;
                                                const exemptRatio = Math.max(0, 1 - exemptMonths / 12);
                                                return ((user.management_fee ?? 0) / 100) * currentEquity * feeRatio * exemptRatio;
                                            })()
                                            : 0;
                                        return (
                                            <TableRow key={user.id}>
                                                <TableCell className="text-center text-muted-foreground font-mono py-1">{index + 1}</TableCell>
                                                <TableCell className="text-center py-1">{user.user_id || '-'}</TableCell>
                                                <TableCell className={`text-center py-1 ${user.role === 'customer' && user.operation_mode === '權利金為主' ? 'bg-note-badge text-foreground' : ''}`}>{user.role === 'customer' ? (user.operation_mode || '-') : '-'}</TableCell>
                                                <TableCell className="text-center py-1">{user.role === 'customer' ? (user.ib_account || '-') : '-'}</TableCell>
                                                <TableCell className={`text-center py-1 ${user.role === 'customer' && user.account_capability === '保證金' ? 'bg-note-badge text-foreground' : ''}`}>{user.role === 'customer' ? (user.account_capability || '-') : '-'}</TableCell>
                                                <TableCell className={`text-center py-1 ${user.start_date && (() => { const d = new Date(user.start_date); return d.getMonth() !== 0 || d.getDate() !== 1; })() ? 'bg-note-badge text-foreground' : ''}`}>
                                                    {user.start_date ? (() => {
                                                        const d = new Date(user.start_date);
                                                        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                    })() : '-'}
                                                </TableCell>
                                                <TableCell className={`text-center py-1 ${user.role === 'customer' && user.management_fee === 0 ? 'bg-note-badge text-foreground' : ''}`}>
                                                    {user.role === 'customer' ? (
                                                        user.management_fee === 0 ? '不收費' : `${user.management_fee}%`
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className={`text-center py-1 ${user.role === 'customer' && (user.fee_exempt_months ?? 0) > 0 ? 'bg-note-badge text-foreground' : ''}`}>
                                                    {user.role === 'customer' ? (
                                                        (user.fee_exempt_months ?? 0) > 0 ? `${user.fee_exempt_months}個月` : '-'
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="text-center py-1">
                                                    {user.role === 'customer' ? formatMoney(estimatedFee) : '-'}
                                                </TableCell>
                                                <TableCell className="text-center py-1">{user.role === 'customer' ? formatMoney(currentEquity) : '-'}</TableCell>
                                                {settings.showPhone && <TableCell className="text-center py-1">{formatPhoneNumber(user.phone)}</TableCell>}
                                                {settings.showEmail && <TableCell className="py-1">{user.email}</TableCell>}
                                                <TableCell className="text-right py-1">
                                                    {currentUser?.role !== 'trader' && currentUser?.role !== 'customer' && (
                                                        <div className="flex justify-end gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleEdit(user)}
                                                                className="text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>



                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="text-muted-foreground hover:text-destructive hover:bg-destructive-soft"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuItem onClick={() => handleClearRecords(user.id)}>
                                                                        <Eraser className="h-4 w-4 mr-2" />
                                                                        清除交易記錄
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={() => handleDelete(user.id)} className="text-destructive focus:text-destructive">
                                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                                        刪除帳號
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    }),
                                    // Summary row
                                    <TableRow key="summary" className="bg-secondary/50 border-t-2">
                                        <TableCell className="text-center py-1">總計</TableCell>
                                        <TableCell colSpan={7} className="text-center py-1"></TableCell>
                                        <TableCell className="text-center py-1">{formatMoney(totalEstimatedFee)}</TableCell>
                                        <TableCell className="text-center py-1">{formatMoney(totalCurrentEquity)}</TableCell>
                                        <TableCell colSpan={1 + (settings.showPhone ? 1 : 0) + (settings.showEmail ? 1 : 0)} className="py-1"></TableCell>
                                    </TableRow>
                                ];
                            })()}
                        </TableBody>
                    </Table>
                </div>

                {/* User Report Cards */}
                {userReports.size > 0 && (
                    <div className="mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {Array.from(userReports.entries())
                                .filter(([aId]) => selectedUserId === 'All' || aId === selectedUserId)
                                .sort(([aId], [bId]) => {
                                    const aEquity = users.find(u => u.id === aId)?.current_net_equity || 0;
                                    const bEquity = users.find(u => u.id === bId)?.current_net_equity || 0;
                                    return bEquity - aEquity;
                                })
                                .map(([userId, { userName, report }]) => (
                                <div key={userId} className="bg-card rounded-lg border shadow-sm p-4 flex flex-col">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="font-semibold text-sm">{userName} 每日報告</h3>
                                        <div className="flex gap-0.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                disabled={sendingMailUserId === userId}
                                                onClick={async () => {
                                                    setSendingMailUserId(userId);
                                                    try {
                                                        // Extract date from report content
                                                        const dateMatch = report.match(/最後更新日 : (\S+)/);
                                                        const dateStr = dateMatch ? dateMatch[1] : '';
                                                        const ccEmailsBase = [
                                                            settings.reportCcEnabled1 ? settings.reportCcEmail1 : null,
                                                            settings.reportCcEnabled2 ? settings.reportCcEmail2 : null,
                                                            settings.reportCcEnabled3 ? settings.reportCcEmail3 : null,
                                                            settings.reportCcEnabled4 ? settings.reportCcEmail4 : null,
                                                        ].filter(e => e && typeof e === 'string' && e.trim() !== '') as string[];

                                                        // Build BCC extras (含交易建議 / 含當日操作) when the admin
                                                        // opted in and there's at least one BCC recipient.
                                                        let bccExtraReport = '';
                                                        const needsExtras = ccEmailsBase.length > 0 &&
                                                            ((settings.bccIncludeTradeAdvice !== false) || (settings.bccIncludeDailyOps !== false));
                                                        if (needsExtras) {
                                                            let dailyTradesCache: DailyTradesCache | null = null;
                                                            if (settings.bccIncludeDailyOps !== false) {
                                                                try {
                                                                    const yearForFetch = selectedYear === 'All' ? new Date().getFullYear() : selectedYear;
                                                                    const latestRes = await fetch(`/api/daily-trades/latest-date?year=${yearForFetch}`);
                                                                    const latestData = await latestRes.json().catch(() => ({}));
                                                                    const tradesDate = latestData.latestDate as string | undefined;
                                                                    if (tradesDate) {
                                                                        const dailyRes = await fetch(`/api/daily-trades?date=${tradesDate}&year=${yearForFetch}`);
                                                                        const dailyJson = await dailyRes.json().catch(() => ({}));
                                                                        dailyTradesCache = { date: tradesDate, data: dailyJson.data || [], marketData: dailyJson.marketData || {} };
                                                                    }
                                                                } catch (e) {
                                                                    console.warn('Failed to load daily-trades for BCC extras:', e);
                                                                }
                                                            }
                                                            bccExtraReport = buildBccExtras(
                                                                users.find(u => u.id === userId),
                                                                {
                                                                    includeTradeAdvice: settings.bccIncludeTradeAdvice !== false,
                                                                    includeDailyOps: settings.bccIncludeDailyOps !== false,
                                                                },
                                                                dailyTradesCache,
                                                            );
                                                        }

                                                        const res = await fetch('/api/users/send-report', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                userId,
                                                                report,
                                                                userName,
                                                                dateStr,
                                                                ccEmails: ccEmailsBase,
                                                                bccExtraReport: bccExtraReport || undefined,
                                                            }),
                                                        });
                                                        const data = await res.json();
                                                        if (res.ok) {
                                                            const userEmail = users.find(u => u.id === userId)?.email || '';
                                                            toast({ title: "已發送", description: `報告已寄送至 ${userEmail}` });
                                                        } else {
                                                            toast({ variant: "destructive", title: "發送失敗", description: data.error || '無法發送郵件' });
                                                        }
                                                    } catch {
                                                        toast({ variant: "destructive", title: "發送失敗", description: '網路錯誤' });
                                                    } finally {
                                                        setSendingMailUserId(null);
                                                    }
                                                }}
                                            >
                                                <Mail className="h-3.5 w-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(report);
                                                    toast({ title: "已複製", description: `${userName} 的報告已複製` });
                                                }}
                                            >
                                                <Copy className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="mb-3">
                                        {editingNoteUserId === userId ? (
                                            <textarea
                                                ref={editingNoteRef}
                                                // 2px ring in note-badge-fg color so the edit-mode
                                                // box reads as visually distinct from the static
                                                // display div (which uses the same bg + text).
                                                className="w-full text-sm p-2 text-note-badge-fg bg-note-badge rounded-md resize-none outline-none ring-2 ring-note-badge-fg/50 focus:ring-note-badge-fg transition-colors placeholder:text-note-badge-fg/70 font-medium overflow-y-auto"
                                                placeholder="在此輸入筆記"
                                                rows={1}
                                                style={{ maxHeight: 120 }}
                                                defaultValue={users.find(u => u.id === userId)?.report_note || ''}
                                                onInput={(e) => {
                                                    const t = e.currentTarget;
                                                    t.style.height = 'auto';
                                                    t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
                                                    scheduleReportNoteSave(userId, t.value);
                                                }}
                                                onBlur={(e) => {
                                                    flushReportNoteSave(userId, e.target.value);
                                                    setEditingNoteUserId(null);
                                                }}
                                            />
                                        ) : (
                                            (() => {
                                                const noteRaw = users.find(u => u.id === userId)?.report_note || '';
                                                // Highlight option-position references like "QQQ 737C"
                                                // or "TQQQ 65.5P" with an inline pill so they pop out
                                                // of the prose. Split lets us interleave plain text
                                                // and badge spans within the same paragraph.
                                                const PILL_SPLIT = /([A-Z]{2,5}\s\d+(?:\.\d+)?[CP])/g;
                                                const PILL_TEST = /^[A-Z]{2,5}\s\d+(?:\.\d+)?[CP]$/;
                                                return (
                                                    <div
                                                        // Outlined-but-empty by default, fills in a
                                                        // soft ring on hover so it's obvious the
                                                        // block is clickable to edit.
                                                        className="w-full text-sm p-2 text-note-badge-fg bg-note-badge rounded-md font-medium whitespace-pre-wrap cursor-pointer overflow-y-auto ring-0 hover:ring-2 hover:ring-note-badge-fg/30 transition-shadow"
                                                        style={{ maxHeight: 120, minHeight: '2.25rem' }}
                                                        onClick={() => setEditingNoteUserId(userId)}
                                                        title="點擊編輯"
                                                    >
                                                        {noteRaw
                                                            ? noteRaw.split(PILL_SPLIT).map((seg, idx) =>
                                                                PILL_TEST.test(seg)
                                                                    ? (
                                                                        <span
                                                                            key={idx}
                                                                            className="inline-block bg-note-badge-fg/15 border border-note-badge-fg/30 rounded px-1 mx-0.5"
                                                                        >
                                                                            {seg}
                                                                        </span>
                                                                    )
                                                                    : <span key={idx}>{seg}</span>,
                                                            )
                                                            : <span className="opacity-60">在此輸入筆記</span>}
                                                    </div>
                                                );
                                            })()
                                        )}
                                    </div>
                                    <pre className="font-mono text-sm whitespace-pre-wrap flex-1 leading-relaxed">
                                        {report.split('\n').map((line, i, arr) => {
                                            const isHighlighted = line.startsWith('潛在融資 :') || line.startsWith('年初至今 :') || line.startsWith('期權收益率') || line.startsWith('帳戶淨值 :');
                                            return (
                                                <span key={i} className={isHighlighted ? "cell-note rounded px-1 -ml-1" : ""}>
                                                    {line}{i < arr.length - 1 ? '\n' : ''}
                                                </span>
                                            );
                                        })}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {isLoadingReports && (
                    <div className="mt-6 text-center text-muted-foreground text-sm py-4">載入報告中...</div>
                )}

                <Dialog open={reportDialog?.open || false} onOpenChange={(open) => !open && setReportDialog(null)}>
                    <DialogContent className="w-[400px] max-w-[90vw] max-h-[95vh]">
                        <DialogHeader>
                            <div className="flex items-center gap-2">
                                <DialogTitle>{reportDialog?.userName} 用戶報告</DialogTitle>
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
                            className="font-mono text-sm min-h-[650px] resize-none"
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

                <AlertDialog open={!!userToClear} onOpenChange={(open) => !open && setUserToClear(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>
                                確定要清除 {users.find(u => u.id === userToClear)?.user_id || users.find(u => u.id === userToClear)?.email || '此使用者'} 的交易記錄嗎？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                此操作無法復原。這將刪除此使用者的所有交易記錄（期權、股票、淨值、利息、管理費、策略），但保留帳號。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmClearRecords}>
                                確認清除
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
                {/* Batch Mail UserSelectionDialog */}
                <UserSelectionDialog
                    open={batchMailOpen}
                    onOpenChange={(open) => {
                        setBatchMailOpen(open);
                        if (!open) {
                            setBatchMailProcessing(false);
                            setBatchMailProgress(0);
                            setBatchMailCompletedIds([]);
                        }
                    }}
                    title="選擇要寄出報告的用戶"
                    description={
                        ((settings.reportCcEnabled1 && settings.reportCcEmail1) || (settings.reportCcEnabled2 && settings.reportCcEmail2) || (settings.reportCcEnabled3 && settings.reportCcEmail3) || (settings.reportCcEnabled4 && settings.reportCcEmail4)) ? (
                            <>
                                將同步密件副本 (BCC) 至：<br />
                                {[
                                    settings.reportCcEnabled1 ? settings.reportCcEmail1 : null,
                                    settings.reportCcEnabled2 ? settings.reportCcEmail2 : null,
                                    settings.reportCcEnabled3 ? settings.reportCcEmail3 : null,
                                    settings.reportCcEnabled4 ? settings.reportCcEmail4 : null
                                ].filter(e => e && typeof e === 'string' && e.trim() !== '').join(', ')}
                            </>
                        ) : undefined
                    }
                    users={batchMailUsers}
                    onConfirm={confirmBatchMail}
                    confirmLabel="開始寄出"
                    processing={batchMailProcessing}
                    progress={batchMailProgress}
                    completedIds={batchMailCompletedIds}
                    preventCloseOnConfirm={true}
                />
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
                                <div className="space-y-3">
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
                                                    {ibImportPreview.parsed.accountCapability && (
                                                        <tr className="border-t">
                                                            <td className="p-1.5">帳戶能力</td>
                                                            <td className="text-right p-1.5 font-mono" colSpan={ibImportPreview.existing ? 2 : 1}>{ibImportPreview.parsed.accountCapability}</td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>

                                            {ibImportPreview.parsed.isYearStart && (
                                                <p className="text-xs cell-info px-2 py-1.5 rounded">
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
                                                                    {action.type === 'open' && <span className="text-status-positive">開倉</span>}
                                                                    {action.type === 'close_full' && <span className="text-status-negative">平倉</span>}
                                                                    {action.type === 'close_split' && <span className="text-chart-orange">拆單平倉</span>}
                                                                </td>
                                                                <td className="p-1.5 font-mono">{action.symbol}</td>
                                                                <td className="text-right p-1.5 font-mono">{action.quantity.toLocaleString()}</td>
                                                                <td className="text-right p-1.5 font-mono">{action.price.toFixed(2)}</td>
                                                                <td className="p-1.5 text-right text-muted-foreground">
                                                                    {action.type === 'open' && '新增持倉'}
                                                                    {action.type === 'close_full' && `${action.existingQuantity}股全平`}
                                                                    {action.type === 'close_split' && `${action.existingQuantity}→${action.remainingQuantity}股`}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {filteredPositionActions.map((pos: any, i: number) => (
                                                            <tr key={`pos-${i}`} className="border-t">
                                                                <td className="p-1.5">
                                                                    <span className="text-chart-blue">同步持倉</span>
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
                                                    <th className="text-center p-1.5">口數</th>
                                                    <th className="text-center p-1.5">類型</th>
                                                    <th className="text-center p-1.5">行權價</th>
                                                    <th className="text-right p-1.5">到期日</th>
                                                    <th className="text-right p-1.5">盈虧</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ibImportPreview.parsed.openOptionActions.filter((a: any) => a.action === 'sync_add').map((pos: any, i: number) => (
                                                    <tr key={`oopt-${i}`} className="border-t">
                                                        <td className="p-1.5">
                                                            <span className="text-chart-blue">同步持倉</span>
                                                        </td>
                                                        <td className="p-1.5 font-mono">{pos.underlying}</td>
                                                        <td className="text-center p-1.5 font-mono">{pos.quantity}</td>
                                                        <td className="text-center p-1.5">
                                                            <span className={pos.type === 'CALL' ? 'text-status-positive' : 'text-status-negative'}>
                                                                {pos.type}
                                                            </span>
                                                        </td>
                                                        <td className="text-center p-1.5 font-mono">{pos.strikePrice}</td>
                                                        <td className="text-right p-1.5 font-mono">{pos.toDateStr}</td>
                                                        <td className={`text-right p-1.5 font-mono ${pos.unrealizedPnl < 0 ? 'text-status-negative' : ''}`}>${Math.round(pos.unrealizedPnl || 0).toLocaleString()}</td>
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
                                                    <th className="text-center p-1.5">口數</th>
                                                    <th className="text-center p-1.5">類型</th>
                                                    <th className="text-center p-1.5">行權價</th>
                                                    <th className="text-right p-1.5">到期日</th>
                                                    <th className="text-right p-1.5">權利金</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {ibImportPreview.parsed.optionActions.map((opt: any, i: number) => (
                                                    <tr key={`opt-${i}`} className={`border-t ${opt.action === 'skip_close' ? 'opacity-40' : opt.action === 'skip_exists' ? 'opacity-60' : ''}`}>
                                                        <td className="p-1.5">
                                                            {opt.action === 'add' && <span className="text-status-positive">新增期權</span>}
                                                            {opt.action === 'close' && <span className="text-status-negative">平倉</span>}
                                                            {opt.action === 'assign' && <span className="text-purple-600">指派</span>}
                                                            {opt.action === 'expire' && <span className="text-muted-foreground">到期</span>}
                                                            {opt.action === 'close_orphan' && <span className="text-chart-orange" title="找不到對應的開倉記錄">平倉(無對應)</span>}
                                                            {opt.action === 'assign_orphan' && <span className="text-chart-orange" title="找不到對應的開倉記錄">指派(無對應)</span>}
                                                            {opt.action === 'expire_orphan' && <span className="text-chart-orange" title="找不到對應的開倉記錄">到期(無對應)</span>}
                                                            {opt.action === 'skip_exists' && <span className="text-muted-foreground">已存在</span>}
                                                            {opt.action === 'skip_close' && <span className="text-muted-foreground">平倉(跳過)</span>}
                                                        </td>
                                                        <td className="p-1.5 font-mono">{opt.underlying}</td>
                                                        <td className="text-center p-1.5 font-mono">{opt.quantity}</td>
                                                        <td className="text-center p-1.5">
                                                            <span className={opt.type === 'CALL' ? 'text-status-positive' : 'text-status-negative'}>
                                                                {opt.type}
                                                            </span>
                                                        </td>
                                                        <td className="text-center p-1.5 font-mono">{opt.strikePrice}</td>
                                                        <td className="text-right p-1.5 font-mono">{opt.toDateStr}</td>
                                                        <td className="text-right p-1.5 font-mono">${Math.round(opt.premium).toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}

                                    {ibStockPreview?.warnings?.length > 0 && (
                                        <div className="text-destructive text-xs space-y-1">
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
                    <AlertDialogContent className="sm:max-w-[750px]">
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
                                <div className="space-y-3">
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
                                                <p className="text-xs text-highlight-orange-fg bg-highlight-orange-bg px-2 py-1.5 rounded">
                                                    ⚠ {batchMessage}
                                                </p>
                                            )}
                                            {batchDateWarnings.length > 0 && (
                                                <div className="text-xs text-highlight-orange-fg bg-highlight-orange-bg px-2 py-1.5 rounded space-y-0.5">
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
                                            <div className="space-y-1 mt-2">
                                                <div className="flex justify-between text-[13px] text-muted-foreground">
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
                                                <div className="max-h-[350px] overflow-y-auto">
                                                    <table className="w-full text-[13px] border rounded">
                                                        <thead>
                                                            <tr className="bg-muted">
                                                                <th className="text-left p-1.5 whitespace-nowrap">日期</th>
                                                                <th className="text-left p-1.5 whitespace-nowrap">用戶</th>
                                                                <th className="text-left p-1.5">結果</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {batchResults.map((r, i) => (
                                                                <tr key={i} className={`border-t ${r.status.startsWith('✗') ? 'bg-destructive-soft' : ''}`}>
                                                                    <td className="p-1.5 font-mono whitespace-nowrap">{r.date}</td>
                                                                    <td className="p-1.5 whitespace-nowrap">{r.user}</td>
                                                                    <td className="p-1.5">
                                                                        {r.status.startsWith('✓') ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <Check className="text-status-positive h-4 w-4 stroke-[3] shrink-0" />
                                                                                <span className="text-[13px]">{r.status.replace(/^✓\s*(年初更新|更新|已匯入)\s*/, '')}</span>
                                                                            </div>
                                                                        ) : (
                                                                            r.status
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}

                                            {batchError && (
                                                <p className="text-[13px] text-destructive bg-destructive-soft px-2 py-1.5 rounded">
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
                <ArchiveImportDialog 
                    open={archiveDialogOpen} 
                    onOpenChange={setArchiveDialogOpen} 
                    users={users}
                    onImport={async (files) => {
                        if (files.length === 1) {
                            await processIbFile(files[0]);
                        } else if (files.length > 1) {
                            await processBatchFiles(files);
                        }
                    }} 
                />
            </div>
    );
}
