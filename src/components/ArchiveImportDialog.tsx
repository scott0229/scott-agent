import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface ArchiveImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onImport: (file: File) => Promise<void>;
}

interface ReportArchive {
    id: number;
    filename: string;
    statement_date: string;
}

export function ArchiveImportDialog({ open, onOpenChange, onImport }: ArchiveImportDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [reports, setReports] = useState<ReportArchive[]>([]);
    
    // Selections
    const [selectedAccount, setSelectedAccount] = useState<string>('');
    const [selectedReportId, setSelectedReportId] = useState<string>('');
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        if (open) {
            fetchReports();
        } else {
            // Reset state when closed
            setSelectedAccount('');
            setSelectedReportId('');
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
        return Array.from(accs).sort();
    }, [reports]);

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
        } else {
            setSelectedReportId('');
        }
    }, [selectedAccount, availableReports]);

    const handleImportClick = async () => {
        if (!selectedReportId) return;
        setIsDownloading(true);
        
        try {
            const targetReport = reports.find(r => r.id.toString() === selectedReportId);
            if (!targetReport) throw new Error('找不到報表記錄');

            // Fetch the raw HTML from the archive API
            const res = await fetch(`/api/reports/${targetReport.id}`);
            if (!res.ok) throw new Error('無法讀取歷史報表內容');
            
            const blob = await res.blob();
            const file = new File([blob], targetReport.filename, { type: 'text/html' });
            
            await onImport(file);
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
                                        {accounts.map(acc => (
                                            <SelectItem key={acc} value={acc}>
                                                {acc}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

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
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button 
                        onClick={handleImportClick} 
                        disabled={!selectedReportId || loading || isDownloading}
                    >
                        {isDownloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        載入並預覽
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
