'use client';

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { isMarketHoliday } from "@/lib/holidays";

interface User {
    id: number;
    email: string;
    user_id: string;
    role: string;
}

interface StockTrade {
    id?: number;
    user_id?: string;
    owner_id?: number;
    year?: number;
    symbol: string;
    status: 'Holding' | 'Closed';
    open_date: number;
    close_date?: number | null;
    open_price: number;
    close_price?: number | null;
    quantity: number;
}

interface StockTradeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tradeToEdit?: StockTrade | null;
    onSuccess: () => void;
    year: number; // Add year prop
}

export function StockTradeDialog({ open, onOpenChange, tradeToEdit, onSuccess, year }: StockTradeDialogProps) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    // Form State
    const [selectedUserId, setSelectedUserId] = useState<string>("");
    const [symbol, setSymbol] = useState("");
    // const [status, setStatus] = useState<'Holding' | 'Closed'>('Holding'); // Derive from closeDate instead
    const [openDate, setOpenDate] = useState<Date | undefined>(undefined);
    const [closeDate, setCloseDate] = useState<Date | undefined>(undefined);
    const [openPrice, setOpenPrice] = useState("");
    const [closePrice, setClosePrice] = useState("");
    const [quantity, setQuantity] = useState("");

    // Calendar open state
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isCloseCalendarOpen, setIsCloseCalendarOpen] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, [year]); // Refetch users when year changes

    useEffect(() => {
        if (open) {
            if (tradeToEdit) {
                // Edit Mode
                setSymbol(tradeToEdit.symbol);
                // setStatus(tradeToEdit.status); // Removed
                setOpenDate(new Date(tradeToEdit.open_date * 1000));
                setCloseDate(tradeToEdit.close_date ? new Date(tradeToEdit.close_date * 1000) : undefined);
                setOpenPrice(tradeToEdit.open_price.toString());
                setClosePrice(tradeToEdit.close_price?.toString() || "");
                setQuantity(tradeToEdit.quantity.toString());
                // Find user and set selectedUserId (User ID for API is usually string 'user_id' or 'email' or the int ID depending on impl)
                // Here we store user_id (string) in DB for API consistency, but UI might use ID
                // Ideally we match by owner_id if available
                if (tradeToEdit.owner_id) {
                    const u = users.find(user => user.id === tradeToEdit.owner_id);
                    if (u) setSelectedUserId(u.id.toString());
                }
            } else {
                // Add Mode
                resetForm();
                // Auto-set open date to today if matches year, else Jan 1 of that year?
                // Or just let user pick. Default today is fine but might trigger validation error if years differ.
                const today = new Date();
                if (today.getFullYear() === year) {
                    setOpenDate(today);
                } else {
                    setOpenDate(new Date(year, 0, 1)); // Jan 1st of selected year
                }

                if (currentUser && currentUser.role !== 'admin' && currentUser.role !== 'manager') {
                    setSelectedUserId(currentUser.id.toString());
                }
            }
        }
    }, [open, tradeToEdit, users, currentUser, year]);

    const fetchUsers = async () => {
        try {
            // Get current user first
            const meRes = await fetch('/api/auth/me');
            let myRole = '';
            if (meRes.ok) {
                const data = await meRes.json();
                setCurrentUser(data.user);
                myRole = data.user?.role;
            }

            // Fetch list for specific year
            const res = await fetch(`/api/users?year=${year}`);
            const data = await res.json();
            if (data.users) {
                // Filter users based on permission?
                // If admin/manager, see all. If trader, see self?
                // The API /api/users usually handles this permissions check.
                setUsers(data.users);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const resetForm = () => {
        setSymbol("");
        // setStatus("Holding");
        // setOpenDate is handled in useEffect
        setCloseDate(undefined);
        setOpenPrice("");
        setClosePrice("");
        setQuantity("");
        // Don't reset selectedUserId if not admin
    };

    const handleSubmit = async () => {
        if (!selectedUserId && !tradeToEdit) { // Require user selection for new trade
            toast({
                variant: "destructive",
                title: "缺少資料",
                description: "請選擇用戶",
            });
            return;
        }
        if (!symbol) {
            toast({
                variant: "destructive",
                title: "缺少資料",
                description: "請輸入代號",
            });
            return;
        }
        if (!openDate) {
            toast({
                variant: "destructive",
                title: "缺少資料",
                description: "請選擇開倉日期",
            });
            return;
        }

        // Validate Year
        // Open Date year check removed as per requirement (allow carry-over)

        // Derive status
        const derivedStatus = closeDate ? 'Closed' : 'Holding';

        // Close Date Validation: Must be in the current year if closed
        if (derivedStatus === 'Closed' && closeDate) {
            if (closeDate.getFullYear() !== year) {
                toast({
                    variant: "destructive",
                    title: "無效的日期",
                    description: `平倉日期必須在 ${year} 年`,
                });
                return;
            }
        }

        if (!openPrice || !quantity) {
            toast({
                variant: "destructive",
                title: "缺少資料",
                description: "請輸入價格和股數",
            });
            return;
        }
        if (derivedStatus === 'Closed' && (!closeDate || !closePrice)) {
            toast({
                variant: "destructive",
                title: "缺少資料",
                description: "請輸入平倉資料",
            });
            return;
        }

        try {
            setLoading(true);

            // Find selected user
            const selectedUser = users.find(u => u.id.toString() === selectedUserId);

            const payload = {
                symbol: symbol.toUpperCase(),
                status: derivedStatus,
                open_date: Math.floor(openDate.getTime() / 1000),
                close_date: closeDate ? Math.floor(closeDate.getTime() / 1000) : null,
                open_price: parseFloat(openPrice),
                close_price: closePrice ? parseFloat(closePrice) : null,
                quantity: parseFloat(quantity),
                userId: selectedUser?.user_id || selectedUser?.email, // API expects string ID
                ownerId: selectedUser?.id, // Database ID
                year: year, // Use prop year
                // If editing, pass ID
                id: tradeToEdit?.id
            };

            const url = tradeToEdit ? `/api/stocks/${tradeToEdit.id}` : '/api/stocks';
            const method = tradeToEdit ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || '操作失敗');
            }

            onSuccess();
            onOpenChange(false);

        } catch (error: any) {
            console.error(error.message);
            toast({
                variant: "destructive",
                title: "操作失敗",
                description: error.message || "未知錯誤",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{tradeToEdit ? "編輯股票交易" : "新增股票交易"}</DialogTitle>

                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Status Dropdown Removed */}

                    {/* Open Date */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">開倉日期</Label>
                        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}

                                    className={cn(
                                        "col-span-3 justify-start text-left font-normal",
                                        !openDate && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {openDate ? format(openDate, "PPP") : <span>選擇日期</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={openDate}
                                    onSelect={(date) => {
                                        setOpenDate(date);
                                        setIsCalendarOpen(false);
                                    }}
                                    disabled={(date) => date.getDay() === 0 || date.getDay() === 6 || isMarketHoliday(date)}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    {/* User Selection */}
                    {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="user" className="text-right">
                                用戶
                            </Label>
                            <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={!!tradeToEdit}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="選擇用戶" />
                                </SelectTrigger>
                                <SelectContent>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.id.toString()}>
                                            {user.user_id || user.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Symbol */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="symbol" className="text-right">
                            代號
                        </Label>
                        <Input
                            id="symbol"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                            className="col-span-3"
                            placeholder="e.g. AAPL"
                            disabled={!!tradeToEdit}
                        />
                    </div>





                    {/* Quantity */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="quantity" className="text-right">
                            股數
                        </Label>
                        <Input
                            id="quantity"
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="col-span-3 no-spinner"
                            placeholder="0"

                        />
                    </div>

                    {/* Open Price */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="openPrice" className="text-right">
                            開倉價格
                        </Label>
                        <Input
                            id="openPrice"
                            type="number"
                            step="0.01"
                            value={openPrice}
                            onChange={(e) => setOpenPrice(e.target.value)}
                            className="col-span-3 no-spinner"
                            placeholder="0.00"

                        />
                    </div>

                    {/* Close Date (Visible in Edit Mode) */}
                    {tradeToEdit && (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">平倉日期</Label>
                                <Popover open={isCloseCalendarOpen} onOpenChange={setIsCloseCalendarOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                                "col-span-3 justify-start text-left font-normal",
                                                !closeDate && "text-muted-foreground"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {closeDate ? format(closeDate, "PPP") : <span>選擇日期</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <div className="p-2 border-b">
                                            <Button
                                                variant="ghost"
                                                className="w-full h-8 text-sm"
                                                onClick={() => {
                                                    setCloseDate(undefined);
                                                    setIsCloseCalendarOpen(false);
                                                }}
                                            >
                                                清除日期 (設為未平倉)
                                            </Button>
                                        </div>
                                        <Calendar
                                            mode="single"
                                            selected={closeDate}
                                            onSelect={(date) => {
                                                setCloseDate(date);
                                                setIsCloseCalendarOpen(false);
                                            }}
                                            disabled={(date) => date.getDay() === 0 || date.getDay() === 6 || isMarketHoliday(date)}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </>
                    )}

                    {/* Close Price - Visible when editing */}
                    {tradeToEdit && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="closePrice" className="text-right">
                                平倉價格
                            </Label>
                            <Input
                                id="closePrice"
                                type="number"
                                step="0.01"
                                value={closePrice}
                                onChange={(e) => setClosePrice(e.target.value)}
                                className="col-span-3 no-spinner"
                                placeholder="0.00"
                            />
                        </div>
                    )}



                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={loading}>
                        {loading ? "處理中..." : (tradeToEdit ? "更新" : "新增")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
