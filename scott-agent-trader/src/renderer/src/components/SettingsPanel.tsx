import type { AccountData } from '../hooks/useAccountStore'

interface SettingsPanelProps {
    open: boolean
    onClose: () => void
    accounts: AccountData[]
    hiddenAccounts: Set<string>
    onToggleAccount: (accountId: string) => void
}

export default function SettingsPanel({
    open,
    onClose,
    accounts,
    hiddenAccounts,
    onToggleAccount
}: SettingsPanelProps): JSX.Element | null {
    if (!open) return null

    const sorted = [...accounts].sort((a, b) => a.accountId.localeCompare(b.accountId))

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>設定</h2>
                    <button className="settings-close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="settings-body">
                    <h3 className="settings-section-title">帳戶顯示</h3>
                    <div className="settings-account-list">
                        {sorted.map((acct) => {
                            const isHidden = hiddenAccounts.has(acct.accountId)
                            return (
                                <label key={acct.accountId} className="settings-account-row">
                                    <span className="settings-account-name">
                                        {acct.alias || acct.accountId}
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={!isHidden}
                                        onChange={() => onToggleAccount(acct.accountId)}
                                    />
                                </label>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
