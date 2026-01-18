import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserOption {
    id: number | string; // Handle both DB ID (number) and potential temp string IDs
    display: string;     // Name/Email to show
    checked?: boolean;   // Initial state
    disabled?: boolean;
}

interface UserSelectionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    users: UserOption[];
    onConfirm: (selectedIds: (number | string)[]) => void;
    confirmLabel?: string;
    hideList?: boolean;
    onlyConfirm?: boolean;
    processing?: boolean;
    progress?: number;
    completedIds?: (number | string)[];
    dependencies?: Record<string, { satisfied: (selected: Set<number | string>) => boolean }>;
    preventCloseOnConfirm?: boolean;
}

export function UserSelectionDialog({
    open,
    onOpenChange,
    title,
    description,
    users,
    onConfirm,
    confirmLabel = "確認",
    hideList = false,
    onlyConfirm = false,
    processing = false,
    progress = 0,
    completedIds = [],
    dependencies,
    preventCloseOnConfirm = false
}: UserSelectionDialogProps) {
    const [selected, setSelected] = useState<Set<number | string>>(new Set());

    // Reset selection when dialog opens or valid users change
    useEffect(() => {
        if (open) {
            const initial = new Set<number | string>();
            users.forEach(u => {
                if (u.checked !== false && !u.disabled) initial.add(u.id);
            });
            setSelected(initial);
        }
    }, [open, users]);

    // Enforce dependencies (Auto-uncheck)
    useEffect(() => {
        if (!dependencies) return;

        let hasChanges = false;
        const next = new Set(selected);

        Object.entries(dependencies).forEach(([dependentId, rule]) => {
            // Check if this dependent item is currently selected
            const numericId = Number(dependentId);
            const idToCheck = isNaN(numericId) ? dependentId : numericId;

            if (next.has(idToCheck) && !rule.satisfied(next)) {
                next.delete(idToCheck);
                hasChanges = true;
            }
        });

        if (hasChanges) {
            setSelected(next);
        }
    }, [selected, dependencies]);

    const handleToggle = (id: number | string) => {
        if (processing) return; // Disable interaction during processing

        const user = users.find(u => u.id === id);
        if (user?.disabled) return;

        // Check if item is disabled by dependency
        if (dependencies) {
            const rule = dependencies[String(id)];
            if (rule && !rule.satisfied(selected)) {
                return; // Cannot toggle if unsatisfied (though UI should be disabled too)
            }
        }

        const next = new Set(selected);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelected(next);
    };

    const handleSelectAll = () => {
        if (processing) return;
        const next = new Set<number | string>();
        users.forEach(u => {
            if (!u.disabled) {
                next.add(u.id);
            }
        });
        setSelected(next);
    };

    const handleDeselectAll = () => {
        if (processing) return;
        setSelected(new Set());
    };

    const handleConfirm = () => {
        onConfirm(Array.from(selected));
        if (!preventCloseOnConfirm) {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => (!processing || progress === 100) && onOpenChange(val)}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription className="text-sm text-muted-foreground mt-3">{description}</DialogDescription>}
                </DialogHeader>

                {!hideList && (
                    <ScrollArea className="h-[300px] border rounded-md p-3">
                        <div className="space-y-3">
                            <div className="flex items-center space-x-3 pb-2 border-b mb-2 sticky top-0 bg-background z-10">
                                <Checkbox
                                    id="select-all"
                                    checked={selected.size === users.length && users.length > 0}
                                    onCheckedChange={(checked: boolean) => {
                                        if (checked) {
                                            handleSelectAll();
                                        } else {
                                            handleDeselectAll();
                                        }
                                    }}
                                    disabled={processing}
                                />
                                <Label
                                    htmlFor="select-all"
                                    className={cn("text-sm font-bold cursor-pointer", processing && "cursor-not-allowed opacity-70")}
                                >
                                    全選
                                </Label>
                                <div className="ml-auto text-sm text-muted-foreground">
                                    {processing ? (progress === 100 ? '已完成' : '處理中...') : `已選擇 ${selected.size} / ${users.length}`}
                                </div>
                            </div>

                            {users.map((user) => {
                                const isCompleted = completedIds.includes(user.id) || (progress === 100 && selected.has(user.id));

                                // Calculate disabled state
                                let isDisabled = processing || user.disabled;
                                if (!isDisabled && dependencies && dependencies[String(user.id)]) {
                                    if (!dependencies[String(user.id)].satisfied(selected)) {
                                        isDisabled = true;
                                    }
                                }

                                return (
                                    <div key={user.id} className="flex items-center space-x-3 group justify-between">
                                        <div className="flex items-center space-x-3">
                                            <Checkbox
                                                id={`user-${user.id}`}
                                                checked={selected.has(user.id)}
                                                onCheckedChange={() => handleToggle(user.id)}
                                                disabled={isDisabled}
                                            />
                                            <Label
                                                htmlFor={`user-${user.id}`}
                                                className={cn(
                                                    "text-sm font-medium leading-none cursor-pointer",
                                                    (processing || isDisabled) && "cursor-not-allowed opacity-70"
                                                )}
                                            >
                                                {user.display}
                                            </Label>
                                        </div>
                                        {isCompleted && (
                                            <div className="flex items-center text-green-600 animate-in fade-in zoom-in duration-300">
                                                <Check className="h-4 w-4" />
                                            </div>
                                        )}
                                        {processing && selected.has(user.id) && !isCompleted && (
                                            <div className="flex items-center text-muted-foreground animate-pulse">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}

                {processing && (
                    <div className="w-full space-y-2 py-2">
                        <Progress value={progress} className="h-2" />
                    </div>
                )}

                <DialogFooter className="flex items-center justify-end gap-2 pt-2">
                    <div className="flex gap-2">
                        {!onlyConfirm && !processing && <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>}
                        <Button
                            onClick={progress === 100 ? () => onOpenChange(false) : handleConfirm}
                            disabled={(!hideList && selected.size === 0) || (processing && progress < 100)}
                        >
                            {processing ? (
                                progress === 100 ? "關閉" : (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        處理中
                                    </>
                                )
                            ) : confirmLabel}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
