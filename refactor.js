const fs = require('fs');

let content = fs.readFileSync('src/app/stocks/page.tsx', 'utf8');

if (!content.includes('StockTradesTable')) {
    content = content.replace(
        "import { StockTradeDialog } from '@/components/StockTradeDialog';",
        "import { StockTradesTable } from '@/components/StockTradesTable';\nimport { StockTradeDialog } from '@/components/StockTradeDialog';"
    );
}

const startMarker = '<div className="bg-white rounded-lg shadow-sm border overflow-hidden">';
const endMarker = '<StockTradeDialog';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    // Find the closing </div> of the table wrapper
    const textBeforeDialog = content.substring(startIndex, endIndex);
    const lastDivIndex = textBeforeDialog.lastIndexOf('</div>');
    
    if (lastDivIndex !== -1) {
        const fullEndIndex = startIndex + lastDivIndex + '</div>'.length;
        
        const replacement = `<StockTradesTable 
                    sortedTrades={sortedTrades}
                    runningDataMap={runningDataMap}
                    settings={settings}
                    currentUser={currentUser}
                    onColorToggle={handleColorToggle}
                    onNoteUpdate={handleNoteUpdate}
                    onGroupUpdate={handleGroupUpdate}
                    onToggleIncludeInOptions={handleToggleIncludeInOptions}
                    onUserClick={setSelectedUserFilter}
                    onSymbolClick={setSymbolFilter}
                    onTransferClick={(trade) => { setTradeToTransfer(trade); setTransferDialogOpen(true); }}
                    onEditClick={(trade) => { setTradeToEdit(trade); setDialogOpen(true); }}
                    formatMoney={formatMoney}
                    formatPnL={formatPnL}
                    formatDate={formatDate}
                />`;
                
        content = content.substring(0, startIndex) + replacement + '\n\n                ' + content.substring(fullEndIndex).trimStart();
        fs.writeFileSync('src/app/stocks/page.tsx', content);
        console.log('Successfully refactored src/app/stocks/page.tsx');
    }
}
