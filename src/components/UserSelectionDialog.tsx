import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";

interface UserOption {
    id: number | string; // Handle both DB ID (number) and potential temp string IDs
    display: string;     // Name/Email to show
    checked?: boolean;   // Initial state
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
    onlyConfirm = false
}: UserSelectionDialogProps) {
    const [selected, setSelected] = useState<Set<number | string>>(new Set());

    // Reset selection when dialog opens or valid users change
    useEffect(() => {
        if (open) {
            const initial = new Set<number | string>();
            users.forEach(u => {
                if (u.checked !== false) initial.add(u.id);
            });
            setSelected(initial);
        }
    }, [open, users]);

    const handleToggle = (id: number | string) => {
        const next = new Set(selected);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelected(next);
    };

    const handleSelectAll = () => {
        const next = new Set<number | string>();
        users.forEach(u => next.add(u.id));
        setSelected(next);
    };

    const handleDeselectAll = () => {
        setSelected(new Set());
    };

    const handleConfirm = () => {
        onConfirm(Array.from(selected));
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <p className="text-sm text-muted-foreground mt-3">{description}</p>}
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
                                />
                                <Label
                                    htmlFor="select-all"
                                    className="text-sm font-bold cursor-pointer"
                                >
                                    全選
                                </Label>
                                <div className="ml-auto text-sm text-muted-foreground">
                                    已選擇 {selected.size} / {users.length} 位
                                </div>
                            </div>

                            {users.map((user) => (
                                <div key={user.id} className="flex items-center space-x-3">
                                    <Checkbox
                                        id={`user-${user.id}`}
                                        checked={selected.has(user.id)}
                                        onCheckedChange={() => handleToggle(user.id)}
                                    />
                                    <Label
                                        htmlFor={`user-${user.id}`}
                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                    >
                                        {user.display}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}

                <DialogFooter className="flex items-center justify-end gap-2 pt-2">
                    <div className="flex gap-2">
                        {!onlyConfirm && <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>}
                        <Button onClick={handleConfirm} disabled={!hideList && selected.size === 0}>
                            {confirmLabel}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
