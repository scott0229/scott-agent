'use client';

import { useState } from 'react';
import TradingViewWidget from '@/components/TradingViewWidget';

export default function TradingViewTestPage() {
    const [symbol, setSymbol] = useState('NASDAQ:QQQ');
    const [scriptId, setScriptId] = useState('i7vJHfIc');
    const [appliedStudies, setAppliedStudies] = useState<string[]>([]);
    const [key, setKey] = useState(0); // Force re-render

    const handleApply = () => {
        const studies = scriptId ? [scriptId] : [];
        setAppliedStudies(studies);
        setKey(prev => prev + 1);
    };

    return (
        <div className="flex flex-col h-screen w-full bg-background text-foreground p-4 gap-4">
            <div className="flex flex-col gap-4 border p-4 rounded-lg bg-card">
                <h1 className="text-xl font-bold">TradingView Strategy Test</h1>
                <div className="flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium">Symbol</label>
                        <input
                            className="border rounded px-3 py-2 bg-background text-foreground w-40"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                        <label className="text-sm font-medium">Script ID / Name (e.g., PUB;...)</label>
                        <input
                            className="border rounded px-3 py-2 bg-background text-foreground w-full"
                            placeholder="Paste your script ID here..."
                            value={scriptId}
                            onChange={(e) => setScriptId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Hint: Open your script in TradingView, Share it, copy the ID from the link.
                        </p>
                    </div>
                    <button
                        onClick={handleApply}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                    >
                        Apply & Reload
                    </button>
                </div>
            </div>

            <div className="flex-1 w-full border rounded-lg overflow-hidden bg-black/5 relative">
                <TradingViewWidget
                    key={key}
                    symbol={symbol}
                    theme="dark"
                    studies={appliedStudies}
                />
            </div>
        </div>
    );
}
