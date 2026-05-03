const fs = require('fs');

let content = fs.readFileSync('src/app/trade-groups/page.tsx', 'utf8');

// 1. Add Import
if (!content.includes('UserStocksDialog')) {
    content = content.replace(
        "import { GroupTradesDialog } from \"@/components/GroupTradesDialog\";",
        "import { GroupTradesDialog } from \"@/components/GroupTradesDialog\";\nimport { UserStocksDialog } from \"@/components/UserStocksDialog\";"
    );
}

// 2. Add State
if (!content.includes('setStocksDialogOpen')) {
    content = content.replace(
        "const [isLoading, setIsLoading] = useState(true);",
        "const [isLoading, setIsLoading] = useState(true);\n    const [stocksDialogOpen, setStocksDialogOpen] = useState(false);"
    );
}

// 3. Add Button
if (!content.includes('>股票交易</Button>')) {
    const symbolFilterSelectStr = `                        <SelectContent>\n                            <SelectItem value="All">所有標的</SelectItem>\n                            {availableSymbols.map((sym: string) => (\n                                <SelectItem key={sym} value={sym}>\n                                    {sym}\n                                </SelectItem>\n                            ))}\n                        </SelectContent>\n                    </Select>`;
    
    content = content.replace(
        symbolFilterSelectStr,
        symbolFilterSelectStr + `\n                    {selectedUserValue !== 'All' && (\n                        <Button variant="secondary" className="ml-2" onClick={() => setStocksDialogOpen(true)}>\n                            股票交易\n                        </Button>\n                    )}`
    );
}

// 4. Add Dialog Component
if (!content.includes('<UserStocksDialog')) {
    const dialogInsertStr = `            {selectedGroup && (`;
    
    const dialogComponentStr = `            {selectedUserValue !== 'All' && (
                <UserStocksDialog
                    isOpen={stocksDialogOpen}
                    onOpenChange={setStocksDialogOpen}
                    userId={selectedUserValue}
                    year={selectedYear}
                />
            )}

`;

    content = content.replace(dialogInsertStr, dialogComponentStr + dialogInsertStr);
}

fs.writeFileSync('src/app/trade-groups/page.tsx', content);
console.log('Successfully refactored src/app/trade-groups/page.tsx');
