import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface ArchiveImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onImport: (files: File[]) => Promise<void>;
    users?: { ib_account?: string; user_id: string | null; email: string }[];
}

interface ReportArchive {
    id: number;
    filename: string;
    statement_date: string;
}

export function ArchiveImportDialog({ open, onOpenChange, onImport, users }: ArchiveImportDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [reports, setReports] = useState<ReportArchive[]>([]);
    
    // Selections
    const [selectedAccount, setSelectedAccount] = useState<string>('');
    const [selectedReportId, setSelectedReportId] = useState<string>('');
    const [importMode, setImportMode] = useState<'single' | 'range'>('single');
    const [startReportId, setStartReportId] = useState<string>('');
    const [endReportId, setEndReportId] = useState<string>('');
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        if (open) {
            fetchReports();
        } else {
            // Reset state when closed
            setSelectedAccount('');
            setSelectedReportId('');
            setStartReportId('');
            setEndReportId('');
        }
    }, [open]);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/reports?limit=5000');
            const data = await res.json();
            if (res.ok && data.reports) {
                setReports(data.reports);
            }
        } catch (error) {
            console.error('Failed to load reports archive', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate unique accounts
    const accounts = useMemo(() => {
        const accs = new Set<string>();
        reports.forEach(r => {
            const match = r.filename.match(/([a-zA-Z0-9_-]+)_(\d{8})/);
            const rawAccount = match ? match[1] : r.filename.split('_')[0];
            accs.add(rawAccount);
        });
        return Array.from(accs).sort((a, b) => {
            const userA = users?.find(u => u.ib_account === a);
            const nameA = userA ? (userA.user_id || userA.email.split('@')[0]) : a;
            const userB = users?.find(u => u.ib_account === b);
            const nameB = userB ? (userB.user_id || userB.email.split('@')[0]) : b;
            return nameA.localeCompare(nameB);
        });
    }, [reports, users]);

    // Calculate available dates for selected account
    const availableReports = useMemo(() => {
        if (!selectedAccount) return [];
        return reports.filter(r => r.filename.includes(selectedAccount)).sort((a, b) => {
            return new Date(b.statement_date).getTime() - new Date(a.statement_date).getTime();
        });
    }, [reports, selectedAccount]);

    // Reset report selection when account changes
    useEffect(() => {
        if (availableReports.length > 0) {
            setSelectedReportId(availableReports[0].id.toString());
            setStartReportId(availableReports[availableReports.length - 1].id.toString()); // Oldest
            setEndReportId(availableReports[0].id.toString()); // Newest
        } else {
            setSelectedReportId('');
            setStartReportId('');
            setEndReportId('');
        }
    }, [selectedAccount, availableReports]);

    const handleImportClick = async () => {
        let targets: ReportArchive[] = [];
        
        if (importMode === 'single') {
            if (!selectedReportId) return;
            const targetReport = reports.find(r => r.id.toString() === selectedReportId);
            if (targetReport) targets = [targetReport];
        } else {
            if (!startReportId || !endReportId) return;
            const startIdx = availableReports.findIndex(r => r.id.toString() === startReportId);
            const endIdx = availableReports.findIndex(r => r.id.toString() === endReportId);
            if (startIdx === -1 || endIdx === -1) return;
            
            const minIdx = Math.min(startIdx, endIdx);
            const maxIdx = Math.max(startIdx, endIdx);
            targets = availableReports.slice(minIdx, maxIdx + 1);
        }

        if (targets.length === 0) {
            toast({ variant: 'destructive', title: '選取錯誤', description: '找不到符合的報表' });
            return;
        }

        setIsDownloading(true);
        
        try {
            const files: File[] = [];
            for (const targetReport of targets) {
                const res = await fetch(`/api/reports/${targetReport.id}`);
                if (!res.ok) throw new Error(`無法讀取檔案: ${targetReport.filename}`);
                const blob = await res.blob();
                files.push(new File([blob], targetReport.filename, { type: 'text/html' }));
            }
            
            await onImport(files);
            onOpenChange(false); // Close dialog on success
            
        } catch (error: any) {
            console.error('Download archive failed:', error);
            toast({
                variant: 'destructive',
                title: '讀取失敗',
                description: error.message || '無法自雲端取得該報表',
            });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>從報表檔案庫匯入</DialogTitle>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-col gap-2">
                                <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="請選擇帳戶" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {accounts.map(acc => {
                                            const user = users?.find(u => u.ib_account === acc);
                                            const displayName = user ? (user.user_id || user.email.split('@')[0]) : acc;
                                            return (
                                                <SelectItem key={acc} value={acc}>
                                                    {displayName}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <Select value={importMode} onValueChange={(val) => setImportMode(val as 'single' | 'range')}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="請選擇匯入模式" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="single">單一報表</SelectItem>
                                        <SelectItem value="range">日期範圍 (批次)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {importMode === 'single' ? (
                                <div className="flex flex-col gap-2">
                                    <Select 
                                        value={selectedReportId} 
                                        onValueChange={setSelectedReportId}
                                        disabled={!selectedAccount || availableReports.length === 0}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="請選擇報表日期" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availableReports.map(report => (
                                                <SelectItem key={report.id} value={report.id.toString()}>
                                                    {report.statement_date}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="flex flex-col gap-2">
                                        <Select 
                                            value={startReportId} 
                                            onValueChange={setStartReportId}
                                            disabled={!selectedAccount || availableReports.length === 0}
                                        >
                                            <SelectTrigger><SelectValue placeholder="起始日期" /></SelectTrigger>
                                            <SelectContent>
                                                {availableReports.map(report => (
                                                    <SelectItem key={`start-${report.id}`} value={report.id.toString()}>
                                                        {report.statement_date}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Select 
                                            value={endReportId} 
                                            onValueChange={setEndReportId}
                                            disabled={!selectedAccount || availableReports.length === 0}
                                        >
                                            <SelectTrigger><SelectValue placeholder="結束日期" /></SelectTrigger>
                                            <SelectContent>
                                                {availableReports.map(report => (
                                                    <SelectItem key={`end-${report.id}`} value={report.id.toString()}>
                                                        {report.statement_date}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button 
                        onClick={handleImportClick} 
                        disabled={(importMode === 'single' ? !selectedReportId : (!startReportId || !endReportId)) || loading || isDownloading}
                    >
                        {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        載入並預覽
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
