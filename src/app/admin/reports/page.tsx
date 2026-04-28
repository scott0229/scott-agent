'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FileUp, Eye, FileText, Loader2, FolderOpen, Users, Trash2, AlertTriangle, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { isMarketHoliday } from '@/lib/holidays';

interface ReportArchive {
    id: number;
    filename: string;
    statement_date: string;
    created_at: number;
}

export default function HistoricalReportsPage() {
    const [reports, setReports] = useState<ReportArchive[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [previewId, setPreviewId] = useState<number | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string>('All');
    const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
    const [selectedDownloadAccounts, setSelectedDownloadAccounts] = useState<Set<string>>(new Set());
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const dirInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const router = useRouter();

    const fetchData = async (showLoader = true) => {
        if (showLoader) setLoading(true);
        try {
            const [resReports, resUsers] = await Promise.all([
                fetch('/api/reports'),
                fetch('/api/users')
            ]);
            
            if (resReports.status === 403) {
                toast({ variant: "destructive", title: "權限不足", description: "您沒有權限訪問此頁面" });
                router.push('/');
                return;
            }
            if (resReports.ok) {
                const data = await resReports.json();
                setReports(data.reports || []);
            }
            if (resUsers.ok) {
                const data = await resUsers.json();
                setUsers(data.users || []);
            }
        } catch (error) {
            console.error('Fetch data failed:', error);
        } finally {
            if (showLoader) setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const groupedReports = useMemo(() => {
        const groups: Record<string, ReportArchive[]> = {};
        reports.forEach(report => {
            let accountId = "未分類";
            const match = report.filename.match(/^([A-Z]+\d+)_/i);
            if (match) {
                accountId = match[1].toUpperCase();
            } else if (report.filename.includes('U')) {
                 const m = report.filename.match(/(U\d+)/i);
                 if (m) accountId = m[1].toUpperCase();
            }
            
            if (!groups[accountId]) groups[accountId] = [];
            groups[accountId].push(report);
        });
        
        Object.keys(groups).forEach(k => {
            groups[k].sort((a,b) => b.statement_date.localeCompare(a.statement_date));
        });
        return groups;
    }, [reports]);

    const handleDeleteAccount = async (accountId: string) => {
        setDeletingId(accountId);
        try {
            const res = await fetch(`/api/reports?accountId=${accountId}`, { method: 'DELETE' });
            if (res.ok) {
                toast({ title: '刪除成功', description: `已清空帳戶 ${accountId} 的報表資料` });
                fetchData(false);
            } else {
                toast({ variant: 'destructive', title: '刪除失敗', description: '無法清空資料' });
            }
        } catch (error) {
            console.error('Delete account failed:', error);
            toast({ variant: 'destructive', title: '刪除失敗', description: '發生系統錯誤' });
        } finally {
            setDeletingId(null);
        }
    };

    const handleDownloadAllClick = () => {
        const allAccounts = Object.keys(groupedReports);
        setSelectedDownloadAccounts(new Set(allAccounts));
        setDownloadProgress(0);
        setIsDownloading(false);
        setDownloadDialogOpen(true);
    };

    const confirmDownloadAll = async () => {
        if (selectedDownloadAccounts.size === 0) return;
        
        try {
            setIsDownloading(true);
            setDownloadProgress(10);
            
            const res = await fetch('/api/reports/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountIds: Array.from(selectedDownloadAccounts) })
            });
            
            setDownloadProgress(70);
            
            if (!res.ok) {
                const contentType = res.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await res.json();
                    throw new Error(errorData.error || '下載失敗');
                } else {
                    const text = await res.text();
                    console.error('Download error response:', text.substring(0, 200));
                    throw new Error(`伺服器錯誤 (${res.status})。可能是檔案過多導致超時，請分批下載。`);
                }
            }
            
            const blob = await res.blob();
            setDownloadProgress(100);
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `selected_historical_reports_${dateStr}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            setTimeout(() => {
                setDownloadDialogOpen(false);
                setIsDownloading(false);
            }, 500);
            
        } catch (error: any) {
            setIsDownloading(false);
            toast({
                variant: 'destructive',
                title: '下載失敗',
                description: error.message
            });
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleDirClick = () => {
        dirInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < files.length; i++) {
            const formData = new FormData();
            formData.append('file', files[i]);

            try {
                const res = await fetch('/api/reports/upload', {
                    method: 'POST',
                    body: formData,
                });
                if (res.ok) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                failCount++;
            }
        }

        setUploading(false);
        if (event.target) event.target.value = '';

        if (successCount > 0) {
            toast({
                title: "上傳完成",
                description: `成功歸檔 ${successCount} 份報表${failCount > 0 ? `，失敗 ${failCount} 份` : ''}`,
            });
            fetchData(false);
        } else if (failCount > 0) {
            toast({
                variant: 'destructive',
                title: "上傳失敗",
                description: "所有檔案皆未能成功歸檔。",
            });
        }
    };

    const formatDate = (unix: number) => {
        if (!unix) return '';
        const d = new Date(unix * 1000);
        return d.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getCompletenessStatus = (accountReports: ReportArchive[]) => {
        if (accountReports.length === 0) return null;
        if (accountReports.length === 1) return "檔案完整";
    
        const latestStr = accountReports[0].statement_date; 
        const earliestStr = accountReports[accountReports.length - 1].statement_date;
        
        const existingDates = new Set(accountReports.map(r => r.statement_date));
        
        let current = new Date(`${earliestStr}T00:00:00`);
        const end = new Date(`${latestStr}T00:00:00`);
        
        let isMissing = false;
        while (current <= end) {
            if (current.getDay() !== 0 && current.getDay() !== 6 && !isMarketHoliday(current)) {
                const y = current.getFullYear();
                const m = String(current.getMonth() + 1).padStart(2, '0');
                const d = String(current.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${d}`;
                if (!existingDates.has(dateStr)) {
                    isMissing = true;
                    break;
                }
            }
            current.setDate(current.getDate() + 1);
        }
        
        return isMissing ? "檔案短缺" : "檔案完整";
    };

    return (
        <div className="container mx-auto py-10">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        2026 檔案庫
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    <Select
                        value={selectedAccountId}
                        onValueChange={setSelectedAccountId}
                    >
                        <SelectTrigger className="w-[150px] h-9 border-border shadow-xs bg-background">
                            <SelectValue placeholder="所有帳號" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">所有帳號</SelectItem>
                            {Object.entries(groupedReports)
                                .sort(([accountIdA], [accountIdB]) => {
                                    const aliasA = users.find(u => u.ib_account === accountIdA)?.user_id || accountIdA;
                                    const aliasB = users.find(u => u.ib_account === accountIdB)?.user_id || accountIdB;
                                    return aliasA.localeCompare(aliasB);
                                })
                                .map(([accountId]) => {
                                    const user = users.find(u => u.ib_account === accountId);
                                    const displayName = user?.user_id || accountId;
                                    return (
                                        <SelectItem key={accountId} value={accountId}>
                                            {displayName}
                                        </SelectItem>
                                    );
                                })}
                        </SelectContent>
                    </Select>
                    <input
                        type="file"
                        accept=".html,text/html"
                        multiple
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                    />
                    <input
                        type="file"
                        accept=".html,text/html"
                        // @ts-expect-error React types don't natively support webkitdirectory yet
                        webkitdirectory=""
                        directory=""
                        multiple
                        className="hidden"
                        ref={dirInputRef}
                        onChange={handleFileChange}
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button disabled={uploading} variant="outline" className="gap-2 hover:bg-accent hover:text-accent-foreground">
                                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                                {uploading ? '上傳中...' : '報表檔案上傳'}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={handleUploadClick} className="cursor-pointer">
                                <FileUp className="h-4 w-4 mr-2" />
                                檔案
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDirClick} className="cursor-pointer">
                                <FolderOpen className="h-4 w-4 mr-2" />
                                資料夾
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button 
                        variant="outline" 
                        onClick={handleDownloadAllClick}
                        className="gap-2 hover:bg-accent hover:text-accent-foreground"
                    >
                        <Download className="h-4 w-4" />
                        下載全部
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="rounded-md border bg-card text-card-foreground shadow-sm p-8 text-center text-muted-foreground">
                    載入中...
                </div>
            ) : reports.length === 0 ? (
                <div className="rounded-md border bg-card text-card-foreground shadow-sm p-8 text-center text-muted-foreground">
                    目前尚無存檔報表。
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                    {Object.entries(groupedReports)
                        .filter(([accountId]) => selectedAccountId === 'All' || accountId === selectedAccountId)
                        .sort(([accountIdA], [accountIdB]) => {
                            const aliasA = users.find(u => u.ib_account === accountIdA)?.user_id || accountIdA;
                            const aliasB = users.find(u => u.ib_account === accountIdB)?.user_id || accountIdB;
                            return aliasA.localeCompare(aliasB);
                        })
                        .map(([accountId, accountReports]) => {
                            const user = users.find(u => u.ib_account === accountId);
                            const displayName = user?.user_id || accountId;
                            
                            return (
                        <div key={accountId} className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col">
                            <div className="px-4 py-2 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold lg:text-lg">
                                        {displayName}
                                    </span>
                                </div>
                                <div className="flex items-center text-sm gap-2 shrink-0 px-2 py-1 flex-row rounded">
                                    {(() => {
                                        const status = getCompletenessStatus(accountReports);
                                        if (!status) return null;
                                        return (
                                            <span className={`px-2 py-0.5 rounded text-sm ${status === '檔案完整' ? 'bg-green-100' : 'bg-red-100'}`}>
                                                {status}
                                            </span>
                                        );
                                    })()}
                                    <span className="pointer-events-none">{accountReports.length} 份檔案</span>
                                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); window.location.href = `/api/reports/export?accountId=${accountId}`; }} className="h-6 w-6 p-0 hover:bg-transparent hover:text-primary transition-all">
                                        <Download className="h-4 w-4" />
                                    </Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button disabled={loading || uploading || deletingId === accountId} variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-transparent hover:text-destructive transition-all">
                                                {deletingId === accountId ? <Loader2 className="h-3 w-3 animate-spin"/> : <Trash2 className="h-3 w-3" />}
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>
                                                    清空 {accountId} 的歷史報表？
                                                </AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    這將會從儀表板中移除帳戶 {accountId} 的所有歷史報表索引。此操作無法復原，您確定要繼續嗎？
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>取消</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteAccount(accountId)} className="bg-destructive hover:bg-destructive/90">
                                                    確定刪除
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                            
                            <div className="border-t bg-background max-h-[350px] overflow-y-auto custom-scrollbar">
                                    <Table>
                                        <TableBody>
                                            {accountReports.map((report, index) => {
                                                const rows = [
                                                    <TableRow 
                                                        key={report.id} 
                                                        onClick={() => setPreviewId(report.id)}
                                                        className="cursor-pointer hover:bg-muted/50 transition-colors odd:bg-[#FDF8F3]/50 dark:odd:bg-muted/10"
                                                    >
                                                        <TableCell className="font-medium px-4 w-[140px] py-1 whitespace-nowrap">
                                                            {report.statement_date} ({['日', '一', '二', '三', '四', '五', '六'][new Date(`${report.statement_date}T00:00:00`).getDay()]})
                                                        </TableCell>
                                                        <TableCell className="py-1 text-sm break-all">
                                                            {report.filename.split('/').pop()}
                                                        </TableCell>
                                                        <TableCell className="py-1 pr-4 text-right w-[40px]">
                                                            <Button 
                                                                variant="ghost" 
                                                                size="sm" 
                                                                onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    window.location.href = `/api/reports/${report.id}?download=1`; 
                                                                }} 
                                                                className="h-6 w-6 p-0 hover:bg-transparent hover:text-primary transition-all text-foreground"
                                                            >
                                                                <Download className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ];

                                                if (index < accountReports.length - 1) {
                                                    const nextReport = accountReports[index + 1];
                                                    
                                                    let d = new Date(`${report.statement_date}T00:00:00`);
                                                    d.setDate(d.getDate() - 1);
                                                    const end = new Date(`${nextReport.statement_date}T00:00:00`);
                                                    
                                                    while (d > end) {
                                                        if (d.getDay() !== 0 && d.getDay() !== 6 && !isMarketHoliday(d)) {
                                                            const y = d.getFullYear();
                                                            const m = String(d.getMonth() + 1).padStart(2, '0');
                                                            const day = String(d.getDate()).padStart(2, '0');
                                                            const missingDateStr = `${y}-${m}-${day}`;
                                                            
                                                            rows.push(
                                                                <TableRow 
                                                                    key={`missing-${missingDateStr}-${accountId}`} 
                                                                    className="bg-red-50/50 hover:bg-red-50/50 pointer-events-none"
                                                                >
                                                                    <TableCell className="font-medium px-4 w-[140px] py-1 whitespace-nowrap text-red-700">
                                                                        {missingDateStr} ({['日', '一', '二', '三', '四', '五', '六'][d.getDay()]})
                                                                    </TableCell>
                                                                    <TableCell colSpan={2} className="py-1 text-sm text-red-700">
                                                                        檔案短缺
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        }
                                                        d.setDate(d.getDate() - 1);
                                                    }
                                                }
                                                return rows;
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                        </div>
                            );
                    })}
                </div>
            )}

            <Dialog open={!!previewId} onOpenChange={(v) => !v && setPreviewId(null)}>
                <DialogContent className="max-w-[1300px] sm:max-w-[1300px] w-[95vw] h-[75vh] flex flex-col p-0 overflow-hidden">
                    <DialogHeader className="px-4 py-2 border-b bg-muted/30">
                        <DialogTitle>{reports.find(r => r.id === previewId)?.filename?.split('/').pop() || '報表預覽'}</DialogTitle>
                    </DialogHeader>
                    {previewId && (
                        <div className="flex-1 w-full bg-white relative">
                            {/* We use a sandbox to ensure styles don't leak, though the API already provides CSP headers. */}
                            <iframe 
                                src={`/api/reports/${previewId}`} 
                                className="w-full h-full border-0 absolute inset-0"
                                sandbox="allow-same-origin allow-scripts" 
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={downloadDialogOpen} onOpenChange={(open) => {
                if (!isDownloading) setDownloadDialogOpen(open);
            }}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>批次下載報表</DialogTitle>
                    </DialogHeader>
                    
                    <div className="py-4">
                        <div className="flex items-center space-x-2 mb-4 pb-4 border-b">
                            <Checkbox 
                                id="select-all-accounts"
                                checked={selectedDownloadAccounts.size === Object.keys(groupedReports).length && Object.keys(groupedReports).length > 0}
                                onCheckedChange={(checked) => {
                                    if (checked) {
                                        setSelectedDownloadAccounts(new Set(Object.keys(groupedReports)));
                                    } else {
                                        setSelectedDownloadAccounts(new Set());
                                    }
                                }}
                                disabled={isDownloading}
                            />
                            <label htmlFor="select-all-accounts" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                                全選 ({Object.keys(groupedReports).length} 個帳戶)
                            </label>
                        </div>
                        
                        <div className="max-h-[250px] overflow-y-auto space-y-3 custom-scrollbar pr-2">
                            {Object.entries(groupedReports)
                                .sort(([accountIdA], [accountIdB]) => {
                                    const aliasA = users.find(u => u.ib_account === accountIdA)?.user_id || accountIdA;
                                    const aliasB = users.find(u => u.ib_account === accountIdB)?.user_id || accountIdB;
                                    return aliasA.localeCompare(aliasB);
                                })
                                .map(([accountId, accountReports]) => {
                                    const user = users.find(u => u.ib_account === accountId);
                                    const displayName = user?.user_id || accountId;
                                    return (
                                        <div key={accountId} className="flex items-center space-x-2">
                                            <Checkbox 
                                                id={`download-${accountId}`}
                                                checked={selectedDownloadAccounts.has(accountId)}
                                                onCheckedChange={(checked) => {
                                                    const newSet = new Set(selectedDownloadAccounts);
                                                    if (checked) newSet.add(accountId);
                                                    else newSet.delete(accountId);
                                                    setSelectedDownloadAccounts(newSet);
                                                }}
                                                disabled={isDownloading}
                                            />
                                            <label htmlFor={`download-${accountId}`} className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-1 cursor-pointer">
                                                {displayName} <span className="text-muted-foreground ml-1">({accountReports.length} 份)</span>
                                            </label>
                                        </div>
                                    );
                                })}
                        </div>
                        
                        {isDownloading && (
                            <div className="mt-6 space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                    <span>打包下載中...</span>
                                    <span>{downloadProgress}%</span>
                                </div>
                                <Progress value={downloadProgress} className="h-2" />
                            </div>
                        )}
                    </div>
                    
                    <DialogFooter>
                        {!isDownloading && (
                            <Button variant="outline" onClick={() => setDownloadDialogOpen(false)}>
                                取消
                            </Button>
                        )}
                        <Button 
                            onClick={confirmDownloadAll} 
                            disabled={isDownloading || selectedDownloadAccounts.size === 0}
                        >
                            {isDownloading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 處理中</> : '開始下載'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
