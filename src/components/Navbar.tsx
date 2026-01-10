'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Users, FolderKanban, TrendingUp } from 'lucide-react';

import { UserProfileMenu } from "@/components/UserProfileMenu";

export function Navbar() {
    const pathname = usePathname();
    const [role, setRole] = useState<string | null>(null);

    useEffect(() => {
        const fetchUserRole = async () => {
            try {
                const res = await fetch('/api/auth/me', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    console.log('Navbar: Auth data received:', data);
                    if (data.user && data.user.role) {
                        setRole(data.user.role);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch user role:', error);
            }
        };
        fetchUserRole();
    }, []);

    console.log('Navbar: Current role:', role, 'isCustomer:', role === 'customer');

    if (pathname === '/' || pathname === '/register' || pathname === '/login') {
        return null;
    }

    const canAccessAdmin = role === 'admin' || role === 'trader';

    return (
        <nav className="sticky top-0 w-full z-50 p-4 flex justify-end gap-2 bg-white/70 dark:bg-black/70 backdrop-blur-xl border-b border-white/20 shadow-sm items-center">
            {canAccessAdmin && (
                <>
                    <Link href="/project-list">
                        <Button
                            variant={pathname.startsWith('/project') ? "default" : "ghost"}
                            className="gap-2"
                        >
                            <FolderKanban className="h-4 w-4" />
                            專案管理
                        </Button>
                    </Link>
                    <Link href="/admin/users">
                        <Button
                            variant={pathname.startsWith('/admin') ? "default" : "ghost"}
                            className="gap-2"
                        >
                            <Users className="h-4 w-4" />
                            使用者管理
                        </Button>
                    </Link>
                </>
            )}
            <Link href="/options">
                <Button
                    variant={pathname.startsWith('/options') ? "default" : "ghost"}
                    className="gap-2"
                >
                    <TrendingUp className="h-4 w-4" />
                    期權管理
                </Button>
            </Link>
            <div className="ml-2">
                <UserProfileMenu />
            </div>
        </nav>
    );
}
