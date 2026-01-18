import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ProgressDialogProps {
    open: boolean;
    title: string;
    description: string;
    progress: number;
    onConfirm?: () => void;
}

export function ProgressDialog({
    open,
    title,
    description,
    progress,
    onConfirm
}: ProgressDialogProps) {
    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-[425px] [&>button]:hidden">
                {/* [&>button]:hidden hides the close X button to prevent closing during operation */}
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="py-6">
                    <Progress value={progress} className="w-full" />
                    <p className="text-sm text-right text-muted-foreground mt-2">{Math.round(progress)}%</p>
                </div>
                {onConfirm && progress === 100 && (
                    <DialogFooter>
                        <Button onClick={onConfirm}>確認</Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
