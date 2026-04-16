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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileUp, Eye, FileText, Loader2, FolderOpen, Users, Trash2, AlertTriangle } from 'lucide-react';
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
                    {Object.entries(groupedReports).map(([accountId, accountReports]) => (
                        <div key={accountId} className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col">
                            <div className="px-4 py-4 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold lg:text-lg">
                                        {users.find(u => u.account_id === accountId) ? `${users.find(u => u.account_id === accountId).alias} - ${accountId}` : accountId}
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
                                                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                                                    >
                                                        <TableCell className="font-medium px-4 w-[120px] py-2">
                                                            {report.statement_date}
                                                        </TableCell>
                                                        <TableCell className="py-2 text-sm break-all">
                                                            {report.filename.split('/').pop()}
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
                                                                    <TableCell className="font-medium px-4 w-[120px] py-2 text-red-700">
                                                                        {missingDateStr}
                                                                    </TableCell>
                                                                    <TableCell className="py-2 text-sm text-red-700">
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
                    ))}
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
        </div>
    );
}
