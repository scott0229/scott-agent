'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function LoginPage() {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ account, password }),
      });

      const data = await res.json() as {
        success: boolean;
        error?: string;
        user?: { role: string; user_id: string; id: number }
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || '登入失敗');
      }

      // Login successful - Cookie is set by the server.
      // Redirect all users to options page
      if (data.user && data.user.role === 'customer') {
        const targetId = data.user.user_id || data.user.id;
        router.push(`/options/${targetId}`);
      } else {
        router.push('/options');
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm shadow-xl bg-white/80 backdrop-blur-sm border-white/20">
        <CardHeader>
          <CardTitle className="text-2xl text-primary font-bold">登入</CardTitle>
          <CardDescription>
            使用帳號密碼登入。
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="account">帳號</Label>
              <Input
                id="account"
                type="text"
                placeholder=""
                required
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="bg-white/50"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white/50"
              />
            </div>
            {error && (
              <div className="text-sm text-red-500 font-medium text-center bg-red-50 p-2 rounded">{error}</div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-4">
            <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" type="submit" disabled={isLoading}>
              {isLoading ? '登入中...' : '登入'}
            </Button>

          </CardFooter>
        </form>
      </Card>
    </div >
  );
}
