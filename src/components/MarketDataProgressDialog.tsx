'use client';

import { useEffect, useState, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X } from "lucide-react";

interface MarketDataProgressDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: number;
    onComplete?: () => void;
}

export function MarketDataProgressDialog({ open, onOpenChange, userId, onComplete }: MarketDataProgressDialogProps) {
    const [isComplete, setIsComplete] = useState(false);
    const [finalMessage, setFinalMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const onCompleteRef = useRef(onComplete);

    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);

    useEffect(() => {
        if (!open) {
            setIsComplete(false);
            setFinalMessage('');
            setIsError(false);
            return;
        }

        let isCancelled = false;

        const startUpdate = async () => {
            try {
                const response = await fetch('/api/market-data/backfill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId })
                });

                if (!response.body) {
                    throw new Error('No response body');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done || isCancelled) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.substring(6));

                                if (data.type === 'complete') {
                                    if (!isCancelled) {
                                        setIsComplete(true);
                                        setFinalMessage(data.message);
                                        setIsError(false);
                                        if (onCompleteRef.current) {
                                            onCompleteRef.current();
                                        }
                                    }
                                    reader.cancel();
                                    return;
                                } else if (data.type === 'error') {
                                    if (!isCancelled) {
                                        setIsComplete(true);
                                        setFinalMessage(data.message);
                                        setIsError(true);
                                    }
                                    reader.cancel();
                                    return;
                                }
                            } catch (e) {
                                console.error('Failed to parse SSE event:', line, e);
                            }
                        }
                    }
                }
            } catch (error: any) {
                if (!isCancelled) {
                    console.error('Stream error:', error);
                    setIsComplete(true);
                    setFinalMessage(`錯誤: ${error.message}`);
                    setIsError(true);
                }
            }
        };

        startUpdate();

        return () => {
            isCancelled = true;
        };
    }, [open, userId]);

    return (
        <Dialog open={open} onOpenChange={(newOpen) => isComplete && onOpenChange(newOpen)}>
            <DialogContent className="max-w-2xl bg-[#f5f1ed]">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
                        {isComplete && !isError && <Check className="h-6 w-6 text-[#a8736a]" />}
                        {isComplete && isError && <X className="h-6 w-6 text-red-600" />}
                        {isComplete ? (isError ? '更新失敗' : '更新成功') : '正在更新市場資料'}
                    </DialogTitle>
                </DialogHeader>
                <DialogDescription asChild>
                    <div className="space-y-6 py-4">
                        {!isComplete && (
                            <div className="flex flex-col items-center justify-center py-8 space-y-4">
                                <Loader2 className="h-12 w-12 animate-spin text-[#a8736a]" strokeWidth={2} />
                                <p className="text-base text-gray-600">處理中，約需 1 分鐘</p>
                            </div>
                        )}

                        {isComplete && finalMessage && (
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                                    {finalMessage}
                                </div>
                            </div>
                        )}
                    </div>
                </DialogDescription>
                <DialogFooter className="gap-3">
                    <Button
                        onClick={() => onOpenChange(false)}
                        disabled={!isComplete}
                        className="min-w-[100px] bg-[#a8736a] hover:bg-[#96655d] text-white disabled:bg-gray-300 disabled:text-gray-500"
                        size="lg"
                    >
                        {isComplete ? '確定' : '更新中...'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
