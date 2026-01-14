'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Users, FolderKanban, TrendingUp, Wallet } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useYearFilter } from '@/contexts/YearFilterContext';

import { UserProfileMenu } from "@/components/UserProfileMenu";

export function Navbar() {
    const pathname = usePathname();
    const [role, setRole] = useState<string | null>(null);
    const { selectedYear, setSelectedYear } = useYearFilter();

    useEffect(() => {
        const fetchUserRole = async () => {
            try {
                // Check session storage cache first
                const cachedRole = sessionStorage.getItem('userRole');
                if (cachedRole && cachedRole !== 'null') {
                    setRole(cachedRole);
                    // Still validate in background but don't block UI
                    fetch('/api/auth/me', { cache: 'no-store' }).then(res => {
                        if (!res.ok) {
                            sessionStorage.removeItem('userRole');
                            setRole(null);
                        }
                    });
                    return;
                }

                const res = await fetch('/api/auth/me', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    console.log('Navbar: Auth data received:', data);
                    if (data.user && data.user.role) {
                        setRole(data.user.role);
                        sessionStorage.setItem('userRole', data.user.role);
                    } else {
                        // If no user data, clear role (user logged out)
                        setRole(null);
                        sessionStorage.removeItem('userRole');
                    }
                } else {
                    // If fetch fails (e.g., 401 Unauthorized), clear role
                    setRole(null);
                    sessionStorage.removeItem('userRole');
                }
            } catch (error) {
                console.error('Failed to fetch user role:', error);
                setRole(null);
                sessionStorage.removeItem('userRole');
            }
        };
        fetchUserRole();
    }, []); // Only run once on mount

    console.log('Navbar: Current role:', role, 'isCustomer:', role === 'customer');

    if (pathname === '/' || pathname === '/register' || pathname === '/login') {
        return null;
    }

    const canAccessAdmin = role === 'admin' || role === 'manager';
    const isOptionsPage = pathname.startsWith('/options') || pathname.startsWith('/admin/users');

    // Generate year options from 2025 (when the website started) to current year
    const currentYear = new Date().getFullYear();
    const startYear = 2025;
    const years = Array.from(
        { length: currentYear - startYear + 1 },
        (_, i) => currentYear - i
    ); // Show in descending order: 2026, 2025, ...

    return (
        <nav className="sticky top-0 w-full z-50 p-4 flex justify-between gap-2 bg-white/70 dark:bg-black/70 backdrop-blur-xl border-b border-white/20 shadow-sm items-center">
            {/* Year Filter - Only show on options pages */}
            {isOptionsPage && (
                <div className="flex items-center gap-2 ml-2">
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="選擇年份" />
                        </SelectTrigger>
                        <SelectContent>
                            {years.map(year => (
                                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {/* Spacer for non-options pages to maintain layout */}
            {!isOptionsPage && <div />}

            <div className="flex gap-2 items-center">
                {/* Projects - visible for all logged-in users */}
                <Link href="/project-list" prefetch={true}>
                    <Button
                        variant={pathname.startsWith('/project') ? "default" : "ghost"}
                        className="gap-2"
                    >
                        <FolderKanban className="h-4 w-4" />
                        專案管理
                    </Button>
                </Link>

                {/* Admin panel - visible for admin/manager and now customer (read-only) */}
                {(canAccessAdmin || role === 'customer') && (
                    <Link href="/admin/users" prefetch={true}>
                        <Button
                            variant={pathname.startsWith('/admin') ? "default" : "ghost"}
                            className="gap-2"
                        >
                            <Users className="h-4 w-4" />
                            帳號管理
                        </Button>
                    </Link>
                )}
                <Link href="/options" prefetch={true}>
                    <Button
                        variant={pathname.startsWith('/options') ? "default" : "ghost"}
                        className="gap-2"
                    >
                        <TrendingUp className="h-4 w-4" />
                        期權交易
                    </Button>
                </Link>
                <Link href="/deposits" prefetch={true}>
                    <Button
                        variant={pathname.startsWith('/deposits') ? "default" : "ghost"}
                        className="gap-2"
                    >
                        <Wallet className="h-4 w-4" />
                        匯款記錄
                    </Button>
                </Link>
                {(canAccessAdmin || role === 'customer') && (
                    <Link href="/net-equity" prefetch={true}>
                        <Button
                            variant={pathname.startsWith('/net-equity') ? "default" : "ghost"}
                            className="gap-2"
                        >
                            <TrendingUp className="h-4 w-4" />
                            帳戶績效
                        </Button>
                    </Link>
                )}
                <div className="ml-2">
                    <UserProfileMenu />
                </div>
            </div>
        </nav>
    );
}
