const fs = require('fs');

const path = 'src/app/trade-groups/page.tsx';
let content = fs.readFileSync(path, 'utf8');

const searchRegex = /(<\/Select>\s*<\/div>\s*<\/div>\s*<div className=\{`space-y-4)/;

const match = content.match(searchRegex);
if (match) {
    const replacement = `</Select>
                    {selectedUserValue !== 'All' && (
                        <Button variant="secondary" className="ml-2" onClick={() => setStocksDialogOpen(true)}>
                            股票交易
                        </Button>
                    )}
                </div>
            </div>

            <div className={\`space-y-4`;

    content = content.replace(searchRegex, replacement);
    fs.writeFileSync(path, content);
    console.log('Button added.');
} else {
    console.log('Regex did not match.');
}
